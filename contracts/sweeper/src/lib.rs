//! Testnet tooling only: deployed over a test contract so its state can be removed and the
//! account deleted back to the funder (NEAR refuses to delete an account with large state).
//! `clean` must be called by the account itself.

use near_sdk::json_types::Base64VecU8;
use near_sdk::{env, near};

#[near(contract_state)]
#[derive(Default)]
pub struct Sweeper {}

#[near]
impl Sweeper {
    /// No `self`: the old contract's state is never read, only removed.
    pub fn clean(keys: Vec<Base64VecU8>) {
        assert_eq!(env::predecessor_account_id(), env::current_account_id(), "self only");
        for k in keys {
            env::storage_remove(&k.0);
        }
    }
}
