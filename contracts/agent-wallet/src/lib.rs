//! The code on every swarm agent account `aN.<swarm>`: one method, `close`, that only the swarm
//! (the account's parent) can call. It deletes the agent account and sends what NEAR is left
//! to the beneficiary the swarm names, which is always the agent's owner on record. Without it
//! an agent account, which holds no full-access key, could never be deleted, and the NEAR
//! behind its storage and its runner's allowance would be locked for good.
//!
//! The input is the beneficiary's account id as raw bytes. No SDK, so it costs a few hundred
//! bytes of storage instead of a hundred kilobytes.
#![cfg_attr(target_arch = "wasm32", no_std)]

#[cfg(target_arch = "wasm32")]
mod wallet {
    #[link(wasm_import_module = "env")]
    extern "C" {
        fn input(register_id: u64);
        fn read_register(register_id: u64, ptr: u64);
        fn register_len(register_id: u64) -> u64;
        fn current_account_id(register_id: u64);
        fn predecessor_account_id(register_id: u64);
        fn promise_batch_create(account_id_len: u64, account_id_ptr: u64) -> u64;
        fn promise_batch_action_delete_account(promise_index: u64, beneficiary_id_len: u64, beneficiary_id_ptr: u64);
        fn panic_utf8(len: u64, ptr: u64) -> !;
    }

    fn fail(msg: &str) -> ! {
        unsafe { panic_utf8(msg.len() as u64, msg.as_ptr() as u64) }
    }

    /// Read register 0 into `buf`, refusing anything that isn't a plausible account id length.
    fn read(buf: &mut [u8; 64]) -> usize {
        let n = unsafe { register_len(0) };
        if n < 2 || n > 64 {
            fail("bad account id");
        }
        unsafe { read_register(0, buf.as_mut_ptr() as u64) };
        n as usize
    }

    #[no_mangle]
    pub extern "C" fn close() {
        let mut me = [0u8; 64];
        let mut caller = [0u8; 64];
        let mut to = [0u8; 64];
        unsafe { current_account_id(0) };
        let me_len = read(&mut me);
        unsafe { predecessor_account_id(0) };
        let caller_len = read(&mut caller);
        // the parent is everything after the first dot: a0.swarm.near -> swarm.near
        let dot = me[..me_len].iter().position(|&c| c == b'.').unwrap_or_else(|| fail("not a sub-account"));
        if &me[dot + 1..me_len] != &caller[..caller_len] {
            fail("swarm only");
        }
        unsafe { input(0) };
        let to_len = read(&mut to);
        unsafe {
            let p = promise_batch_create(me_len as u64, me.as_ptr() as u64);
            promise_batch_action_delete_account(p, to_len as u64, to.as_ptr() as u64);
        }
    }

    #[panic_handler]
    fn panic(_: &core::panic::PanicInfo) -> ! {
        core::arch::wasm32::unreachable()
    }
}
