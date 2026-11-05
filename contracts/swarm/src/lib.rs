//! Priced In swarm: anyone adds an agent by funding it with NEAR, in one transaction.
//!
//! `spawn_agent` creates the sub-account `aN.<swarm>` with one key: the runner's function-call
//! key, limited to the market's `buy`, `sell` and `redeem` with a 0.25 NEAR allowance. The
//! account has no full-access key and no code, so nobody can withdraw from it, the runner
//! included. Its USDC bankroll arrives with `ft_transfer_call` and {"for":"aN.<swarm>"}, and
//! leaves only through `release_bankroll`, to the owner on record here.
//!
//! The rest of the deposit is the agent's inference escrow, held here. The operator's metered
//! charge sweeps it to the treasury account with a usage hash and an event. At zero the agent
//! sleeps. The owner can top it up or close the agent and take back what is left.

use near_sdk::json_types::{U128, U64};
use near_sdk::store::LookupMap;
use near_sdk::{env, near, AccountId, Allowance, Gas, NearToken, PanicOnDefault, Promise, PublicKey};

const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const RUNNER_ALLOWANCE: u128 = NEAR / 4;
const RUNNER_METHODS: &str = "buy,sell,redeem";
const GAS_CALLBACK: Gas = Gas::from_tgas(10);
const GAS_RELEASE: Gas = Gas::from_tgas(10);

fn ensure(cond: bool, msg: &str) {
    if !cond {
        env::panic_str(msg)
    }
}

fn ensure_hash(s: &str, what: &str) {
    if s.len() != 64 || !s.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c)) {
        env::panic_str(&format!("{} must be 64 lowercase hex characters", what))
    }
}

fn json_escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Agent {
    pub id: u64,
    pub account: AccountId,
    pub owner: AccountId,
    pub model: String,
    pub persona_hash: String,
    pub runner_public_key: String,
    /// yoctoNEAR left for inference
    pub escrow_yocto: U128,
    /// yoctoNEAR swept so far
    pub charged_yocto: U128,
    pub sleeping: bool,
    pub closed: bool,
    pub created_ns: U64,
}

#[near(serializers = [json])]
pub struct Stats {
    pub agents: u64,
    pub escrow_yocto: U128,
    pub min_spawn_yocto: U128,
    pub agent_near_yocto: U128,
    pub market: AccountId,
    pub treasury: AccountId,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Swarm {
    owner: AccountId,
    pending_owner: Option<AccountId>,
    market: AccountId,
    /// Where swept escrow goes. It is fixed by the owner, so an operator's key can't redirect it.
    treasury: AccountId,
    operators: LookupMap<AccountId, bool>,
    agents: LookupMap<u64, Agent>,
    next_agent: u64,
    escrow_yocto: u128,
    min_spawn_yocto: u128,
    /// What each new agent account receives: its storage, and gas behind the runner's allowance.
    agent_near_yocto: u128,
}

#[near]
impl Swarm {
    #[init]
    pub fn new(owner: AccountId, market: AccountId, treasury: AccountId) -> Self {
        Self {
            owner,
            pending_owner: None,
            market,
            treasury,
            operators: LookupMap::new(b"o"),
            agents: LookupMap::new(b"a"),
            next_agent: 0,
            escrow_yocto: 0,
            min_spawn_yocto: 5 * NEAR,
            agent_near_yocto: NEAR * 26 / 100,
        }
    }

    fn assert_owner(&self) {
        ensure(env::predecessor_account_id() == self.owner, "owner only");
    }

    fn is_operator(&self) -> bool {
        let p = env::predecessor_account_id();
        p == self.owner || self.operators.get(&p).copied().unwrap_or(false)
    }

    /// aN.<swarm> -> N
    fn agent_index(&self, agent_id: &AccountId) -> u64 {
        let suffix = format!(".{}", env::current_account_id());
        agent_id
            .as_str()
            .strip_suffix(suffix.as_str())
            .and_then(|p| p.strip_prefix('a'))
            .and_then(|n| n.parse().ok())
            .unwrap_or_else(|| env::panic_str("no such agent"))
    }

    fn agent(&self, agent_id: &AccountId) -> Agent {
        let n = self.agent_index(agent_id);
        match self.agents.get(&n) {
            Some(a) if a.account == *agent_id => a.clone(),
            _ => env::panic_str("no such agent"),
        }
    }

    /// Handing over takes two steps, so a mistyped account can't lock the owner out.
    pub fn propose_owner(&mut self, account: AccountId) {
        self.assert_owner();
        self.pending_owner = Some(account);
    }

    pub fn accept_owner(&mut self) {
        ensure(self.pending_owner.as_ref() == Some(&env::predecessor_account_id()), "not the proposed owner");
        self.owner = env::predecessor_account_id();
        self.pending_owner = None;
        self.log("owner", &format!("{{\"owner\":\"{}\"}}", self.owner));
    }

    pub fn set_operator(&mut self, account: AccountId, allowed: bool) {
        self.assert_owner();
        self.operators.insert(account, allowed);
    }

    pub fn set_treasury(&mut self, treasury: AccountId) {
        self.assert_owner();
        self.treasury = treasury;
    }

    pub fn set_limits(&mut self, min_spawn_yocto: U128, agent_near_yocto: U128) {
        self.assert_owner();
        ensure(min_spawn_yocto.0 > agent_near_yocto.0, "a spawn must leave an escrow");
        ensure(agent_near_yocto.0 >= NEAR / 100, "an agent account needs storage");
        self.min_spawn_yocto = min_spawn_yocto.0;
        self.agent_near_yocto = agent_near_yocto.0;
    }

    /// One transaction adds an agent. The caller owns it. The escrow is the deposit minus the
    /// agent account's funding and the storage of this record. If the account can't be created,
    /// the callback returns the whole deposit.
    #[payable]
    pub fn spawn_agent(&mut self, model: String, persona_hash: String, runner_public_key: PublicKey) -> Promise {
        let deposit = env::attached_deposit().as_yoctonear();
        ensure(deposit >= self.min_spawn_yocto, "an agent needs at least the minimum deposit");
        ensure(!model.is_empty() && model.len() <= 128, "model must be 1..128 bytes");
        ensure_hash(&persona_hash, "persona_hash");
        let owner = env::predecessor_account_id();
        let id = self.next_agent;
        self.next_agent += 1;
        let account: AccountId = format!("a{}.{}", id, env::current_account_id()).parse().unwrap_or_else(|_| env::panic_str("the swarm's name is too long"));
        let before = env::storage_usage();
        self.agents.insert(
            id,
            Agent {
                id,
                account: account.clone(),
                owner: owner.clone(),
                model: model.clone(),
                persona_hash: persona_hash.clone(),
                runner_public_key: String::from(&runner_public_key),
                escrow_yocto: U128(0),
                charged_yocto: U128(0),
                sleeping: false,
                closed: false,
                created_ns: U64(env::block_timestamp()),
            },
        );
        self.agents.flush();
        let storage = (env::storage_usage() - before) as u128 * env::storage_byte_cost().as_yoctonear();
        let escrow = deposit.checked_sub(self.agent_near_yocto + storage).unwrap_or_else(|| env::panic_str("the deposit can't cover the account"));
        self.agents.get_mut(&id).unwrap().escrow_yocto = U128(escrow);
        self.escrow_yocto += escrow;
        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"pricedin-swarm\",\"version\":\"1.0.0\",\"event\":\"spawn\",\"data\":[{{\"agent\":\"{}\",\"owner\":\"{}\",\"model\":\"{}\",\"persona_hash\":\"{}\",\"escrow_yocto\":\"{}\"}}]}}",
            account, owner, json_escape(&model), persona_hash, escrow
        ));
        let allowance = Allowance::limited(NearToken::from_yoctonear(RUNNER_ALLOWANCE)).unwrap_or_else(|| env::panic_str("bad allowance"));
        Promise::new(account)
            .create_account()
            .transfer(NearToken::from_yoctonear(self.agent_near_yocto))
            .add_access_key_allowance(runner_public_key, allowance, self.market.clone(), RUNNER_METHODS)
            .then(Promise::new(env::current_account_id()).function_call(
                "on_spawn".to_string(),
                format!("{{\"id\":{},\"deposit\":\"{}\"}}", id, deposit).into_bytes(),
                NearToken::from_yoctonear(0),
                GAS_CALLBACK,
            ))
    }

    #[private]
    pub fn on_spawn(&mut self, id: u64, deposit: U128) -> bool {
        if env::promise_result_checked(0, 64).is_ok() {
            return true;
        }
        if let Some(a) = self.agents.remove(&id) {
            self.escrow_yocto -= a.escrow_yocto.0;
            self.log("spawn_failed", &format!("{{\"agent\":\"{}\",\"owner\":\"{}\",\"refund_yocto\":\"{}\"}}", a.account, a.owner, deposit.0));
            Promise::new(a.owner).transfer(NearToken::from_yoctonear(deposit.0)).detach();
        }
        false
    }

    /// The operator's metered inference charge, up to what is left. The money goes to the
    /// treasury account and the usage hash goes into the event log. At zero the agent sleeps.
    pub fn sweep_escrow(&mut self, agent_id: AccountId, amount_yocto: U128, usage_hash: String) -> U128 {
        ensure(self.is_operator(), "operators only");
        ensure_hash(&usage_hash, "usage_hash");
        let mut a = self.agent(&agent_id);
        let charged = amount_yocto.0.min(a.escrow_yocto.0);
        ensure(charged > 0, "nothing to sweep");
        a.escrow_yocto = U128(a.escrow_yocto.0 - charged);
        a.charged_yocto = U128(a.charged_yocto.0 + charged);
        a.sleeping = a.sleeping || a.escrow_yocto.0 == 0;
        self.escrow_yocto -= charged;
        self.log("sweep", &format!("{{\"agent\":\"{}\",\"amount_yocto\":\"{}\",\"usage_hash\":\"{}\",\"escrow_yocto\":\"{}\",\"sleeping\":{}}}", agent_id, charged, usage_hash, a.escrow_yocto.0, a.sleeping));
        self.agents.insert(a.id, a);
        Promise::new(self.treasury.clone()).transfer(NearToken::from_yoctonear(charged)).detach();
        U128(charged)
    }

    /// Permissionless, and only at zero escrow: an agent with nothing left for inference sleeps.
    pub fn set_sleeping(&mut self, agent_id: AccountId) {
        let mut a = self.agent(&agent_id);
        ensure(a.escrow_yocto.0 == 0, "this agent still has escrow");
        a.sleeping = true;
        self.log("sleep", &format!("{{\"agent\":\"{}\"}}", agent_id));
        self.agents.insert(a.id, a);
    }

    /// Anyone can refill an agent's escrow. That wakes it.
    #[payable]
    pub fn top_up_escrow(&mut self, agent_id: AccountId) -> U128 {
        let amount = env::attached_deposit().as_yoctonear();
        ensure(amount > 0, "attach NEAR to top up");
        let mut a = self.agent(&agent_id);
        ensure(!a.closed, "this agent is closed");
        a.escrow_yocto = U128(a.escrow_yocto.0 + amount);
        a.sleeping = false;
        self.escrow_yocto += amount;
        let left = a.escrow_yocto;
        self.log("top_up", &format!("{{\"agent\":\"{}\",\"amount_yocto\":\"{}\",\"escrow_yocto\":\"{}\"}}", agent_id, amount, left.0));
        self.agents.insert(a.id, a);
        left
    }

    fn release(&self, a: &Agent, amount_micro: Option<U128>) -> Promise {
        let amount = amount_micro.map_or("null".to_string(), |x| format!("\"{}\"", x.0));
        Promise::new(self.market.clone()).function_call(
            "release_agent".to_string(),
            format!("{{\"agent\":\"{}\",\"to\":\"{}\",\"amount_micro\":{}}}", a.account, a.owner, amount).into_bytes(),
            NearToken::from_yoctonear(0),
            GAS_RELEASE,
        )
    }

    /// The owner moves the agent's market balance to their own market balance, where
    /// `withdraw` works. `None` moves all of it. This stays open after `close_agent`, so
    /// winnings redeemed later still reach the owner.
    pub fn release_bankroll(&mut self, agent_id: AccountId, amount_micro: Option<U128>) -> Promise {
        let a = self.agent(&agent_id);
        ensure(env::predecessor_account_id() == a.owner, "agent owner only");
        self.release(&a, amount_micro)
    }

    /// The owner ends the agent: the escrow comes back and the bankroll is released. If the
    /// release fails (a paused market) nothing is lost: call `release_bankroll` again.
    pub fn close_agent(&mut self, agent_id: AccountId) -> Promise {
        let mut a = self.agent(&agent_id);
        ensure(env::predecessor_account_id() == a.owner, "agent owner only");
        ensure(!a.closed, "already closed");
        let escrow = a.escrow_yocto.0;
        a.escrow_yocto = U128(0);
        a.closed = true;
        a.sleeping = true;
        self.escrow_yocto -= escrow;
        self.log("close", &format!("{{\"agent\":\"{}\",\"owner\":\"{}\",\"refund_yocto\":\"{}\"}}", agent_id, a.owner, escrow));
        let release = self.release(&a, None);
        let owner = a.owner.clone();
        self.agents.insert(a.id, a);
        if escrow > 0 {
            Promise::new(owner).transfer(NearToken::from_yoctonear(escrow)).detach();
        }
        release
    }

    pub fn get_agent(&self, agent_id: AccountId) -> Option<Agent> {
        let n = agent_id.as_str().strip_suffix(format!(".{}", env::current_account_id()).as_str())?.strip_prefix('a')?.parse::<u64>().ok()?;
        self.agents.get(&n).filter(|a| a.account == agent_id).cloned()
    }

    pub fn get_agents(&self, from: u64, limit: u64) -> Vec<Agent> {
        let end = from.saturating_add(limit.min(100)).min(self.next_agent);
        (from..end).filter_map(|i| self.agents.get(&i).cloned()).collect()
    }

    pub fn stats(&self) -> Stats {
        Stats {
            agents: self.next_agent,
            escrow_yocto: U128(self.escrow_yocto),
            min_spawn_yocto: U128(self.min_spawn_yocto),
            agent_near_yocto: U128(self.agent_near_yocto),
            market: self.market.clone(),
            treasury: self.treasury.clone(),
        }
    }

    fn log(&self, event: &str, data: &str) {
        env::log_str(&format!("EVENT_JSON:{{\"standard\":\"pricedin-swarm\",\"version\":\"1.0.0\",\"event\":\"{}\",\"data\":[{}]}}", event, data));
    }
}
