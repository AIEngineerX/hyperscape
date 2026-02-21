#![allow(unexpected_cfgs)]
#![allow(deprecated)]

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("4phSkAVkbtGbQbrT3p2xjNPLAyw1DWz99wT7g4dQMyiX");

#[program]
pub mod gold_clob_market {
    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        treasury_token_account: Pubkey,
        market_maker_token_account: Pubkey,
        trading_fee_bps: u16,
        winnings_fee_bps: u16,
    ) -> Result<()> {
        require!(trading_fee_bps <= 10_000, ErrorCode::InvalidFeeBps);
        require!(winnings_fee_bps <= 10_000, ErrorCode::InvalidFeeBps);

        let config = &mut ctx.accounts.config;
        config.authority = *ctx.accounts.authority.key;
        config.treasury_token_account = treasury_token_account;
        config.market_maker_token_account = market_maker_token_account;
        config.trading_fee_bps = trading_fee_bps;
        config.winnings_fee_bps = winnings_fee_bps;

        Ok(())
    }

    pub fn initialize_order_book(ctx: Context<InitializeOrderBook>) -> Result<()> {
        let order_book = &mut ctx.accounts.order_book;
        order_book.match_state = ctx.accounts.match_state.key();
        order_book.balances = Vec::new();
        order_book.orders = Vec::new();
        Ok(())
    }

    pub fn initialize_match(ctx: Context<InitializeMatch>, _yes_price: u16) -> Result<()> {
        let match_state = &mut ctx.accounts.match_state;
        match_state.is_open = true;
        match_state.winner = 0;
        match_state.next_order_id = 1;
        match_state.vault_authority_bump = ctx.bumps.vault_authority;
        match_state.authority = *ctx.accounts.user.key; // Store deployer as authority
        Ok(())
    }

    pub fn place_order(
        ctx: Context<PlaceOrder>,
        is_buy: bool,
        price: u16,
        amount: u64,
    ) -> Result<()> {
        let match_state = &mut ctx.accounts.match_state;
        let order_book = &mut ctx.accounts.order_book;

        require!(match_state.is_open, ErrorCode::MatchClosed);
        require!(price > 0 && price < 1000, ErrorCode::InvalidPrice);

        let cost = amount.checked_mul(if is_buy { price as u64 } else { 1000 - price as u64 })
            .unwrap()
            .checked_div(1000)
            .unwrap();
        require!(cost > 0, ErrorCode::CostTooLow);

        let cpi_accounts = Transfer {
            from: ctx.accounts.user_token_account.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, cost)?;

        let mut remaining_amount = amount;
        let mut matches_count = 0;
        const MAX_MATCHES_PER_TX: u32 = 50; // Keep compute under budget

        loop {
            if remaining_amount == 0 || matches_count >= MAX_MATCHES_PER_TX { break; }
            let mut best_index = None;
            let mut best_price = if is_buy { 1000 } else { 0 };

            for (i, order) in order_book.orders.iter().enumerate() {
                if order.is_buy == is_buy { continue; }
                if order.filled >= order.amount { continue; }
                if is_buy {
                    if order.price <= price && order.price < best_price {
                        best_price = order.price;
                        best_index = Some(i);
                    }
                } else if order.price >= price && order.price > best_price {
                    best_price = order.price;
                    best_index = Some(i);
                }
            }

            if let Some(i) = best_index {
                let maker_price = order_book.orders[i].price;
                let maker_remaining = order_book.orders[i].amount - order_book.orders[i].filled;
                let fill_amount = std::cmp::min(remaining_amount, maker_remaining);

                order_book.orders[i].filled += fill_amount;
                remaining_amount -= fill_amount;
                let maker = order_book.orders[i].maker;

                if is_buy {
                    add_shares(order_book, maker, 0, fill_amount);
                    add_shares(order_book, *ctx.accounts.user.key, fill_amount, 0);

                    // Locked Funds Fix: Taker pays `price` (worse), maker asked `maker_price` (better).
                    if price > maker_price {
                        let improvement = fill_amount.checked_mul((price - maker_price) as u64)
                            .unwrap()
                            .checked_div(1000)
                            .unwrap();
                        if improvement > 0 {
                            let match_key = match_state.key();
                            let bump = match_state.vault_authority_bump;
                            let seeds: &[&[u8]] = &[
                                b"vault_auth",
                                match_key.as_ref(),
                                &[bump],
                            ];
                            let signer_seeds: &[&[&[u8]]] = &[seeds];
                            let cpi_accounts = Transfer {
                                from: ctx.accounts.vault.to_account_info(),
                                to: ctx.accounts.user_token_account.to_account_info(),
                                authority: ctx.accounts.vault_authority.to_account_info(),
                            };
                            let cpi_ctx = CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), cpi_accounts, signer_seeds);
                            token::transfer(cpi_ctx, improvement)?;
                        }
                    }
                } else {
                    add_shares(order_book, maker, fill_amount, 0);
                    add_shares(order_book, *ctx.accounts.user.key, 0, fill_amount);

                    // Locked Funds Fix: Taker asked `price` (worse), maker bid `maker_price` (better).
                    if maker_price > price {
                        let improvement = fill_amount.checked_mul((maker_price - price) as u64)
                            .unwrap()
                            .checked_div(1000)
                            .unwrap();
                        if improvement > 0 {
                            let match_key = match_state.key();
                            let bump = match_state.vault_authority_bump;
                            let seeds: &[&[u8]] = &[
                                b"vault_auth",
                                match_key.as_ref(),
                                &[bump],
                            ];
                            let signer_seeds: &[&[&[u8]]] = &[seeds];
                            let cpi_accounts = Transfer {
                                from: ctx.accounts.vault.to_account_info(),
                                to: ctx.accounts.user_token_account.to_account_info(),
                                authority: ctx.accounts.vault_authority.to_account_info(),
                            };
                            let cpi_ctx = CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), cpi_accounts, signer_seeds);
                            token::transfer(cpi_ctx, improvement)?;
                        }
                    }
                }
                matches_count += 1;
            } else {
                break;
            }
        }

        if remaining_amount > 0 {
            let order = Order {
                id: match_state.next_order_id,
                maker: *ctx.accounts.user.key,
                is_buy,
                price,
                amount,
                filled: amount - remaining_amount,
            };
            order_book.orders.push(order);
            match_state.next_order_id += 1;
        }

        // Clean up fully matched orders to optimize compute during future iterations
        order_book.orders.retain(|order| order.filled < order.amount);

        Ok(())
    }

    pub fn cancel_order(ctx: Context<CancelOrder>, order_id: u64) -> Result<()> {
        let match_state = &mut ctx.accounts.match_state;
        let order_book = &mut ctx.accounts.order_book;
        require!(match_state.is_open, ErrorCode::MatchClosed);

        let order_index = order_book.orders.iter().position(|o| o.id == order_id)
            .ok_or(ErrorCode::OrderNotFound)?;

        {
            let order = &mut order_book.orders[order_index];
            require!(order.maker == *ctx.accounts.user.key, ErrorCode::NotOrderMaker);
            require!(order.filled < order.amount, ErrorCode::AlreadyFilled);

            let remaining = order.amount - order.filled;
            order.filled = order.amount; // Mark as fully filled/cancelled

            let cost = remaining.checked_mul(if order.is_buy { order.price as u64 } else { 1000 - order.price as u64 })
                .unwrap()
                .checked_div(1000)
                .unwrap();

            let match_key = match_state.key();
            let bump = match_state.vault_authority_bump;

            let seeds: &[&[u8]] = &[
                b"vault_auth",
                match_key.as_ref(),
                &[bump],
            ];

            let cpi_accounts = Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.user_token_account.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            };
            let cpi_program = ctx.accounts.token_program.to_account_info();
            let signer_seeds: &[&[&[u8]]] = &[seeds];
            let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
            token::transfer(cpi_ctx, cost)?;
        }

        // Clean up the cancelled order immediately
        order_book.orders.retain(|order| order.filled < order.amount);

        Ok(())
    }

    pub fn resolve_match(ctx: Context<ResolveMatch>, winner: u8) -> Result<()> {
        let match_state = &mut ctx.accounts.match_state;
        require!(match_state.is_open, ErrorCode::MatchClosed);
        require!(
            *ctx.accounts.authority.key == match_state.authority,
            ErrorCode::UnauthorizedResolver
        );
        match_state.is_open = false;
        match_state.winner = winner;
        Ok(())
    }

    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let match_state = &ctx.accounts.match_state;
        let order_book = &mut ctx.accounts.order_book;
        require!(!match_state.is_open, ErrorCode::MatchStillOpen);
        require_keys_eq!(
            ctx.accounts.treasury_token_account.key(),
            ctx.accounts.config.treasury_token_account,
            ErrorCode::InvalidFeeAccount
        );
        require_keys_eq!(
            ctx.accounts.market_maker_token_account.key(),
            ctx.accounts.config.market_maker_token_account,
            ErrorCode::InvalidFeeAccount
        );

        let user_key = ctx.accounts.user.key();
        let mut winning_shares = 0;

        // Find user balances and clear them
        if let Some(bal) = order_book.balances.iter_mut().find(|b| b.user == user_key) {
            if match_state.winner == 1 {
                winning_shares = bal.yes_shares;
                bal.yes_shares = 0; // Only zero winning side
            } else if match_state.winner == 2 {
                winning_shares = bal.no_shares;
                bal.no_shares = 0; // Only zero winning side
            }
        }

        require!(winning_shares > 0, ErrorCode::NothingToClaim);

        let fee = winning_shares
            .checked_mul(ctx.accounts.config.winnings_fee_bps as u64)
            .unwrap()
            .checked_div(10000)
            .unwrap();
        let payout = winning_shares.checked_sub(fee).unwrap();
        let half_fee = fee.checked_div(2).unwrap();
        let mm_fee = fee.checked_sub(half_fee).unwrap();

        let seeds: &[&[u8]] = &[
            b"vault_auth",
            ctx.accounts.match_state.to_account_info().key.as_ref(),
            &[match_state.vault_authority_bump],
        ];
        let signer_seeds: &[&[&[u8]]] = &[seeds];

        // 1. Transfer to Treasury
        if half_fee > 0 {
            let treasury_cpi_accounts = Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.treasury_token_account.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            };
            let treasury_cpi_ctx = CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), treasury_cpi_accounts, signer_seeds);
            token::transfer(treasury_cpi_ctx, half_fee)?;
        }

        // 2. Transfer to Market Maker
        if mm_fee > 0 {
            let mm_cpi_accounts = Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.market_maker_token_account.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            };
            let mm_cpi_ctx = CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), mm_cpi_accounts, signer_seeds);
            token::transfer(mm_cpi_ctx, mm_fee)?;
        }

        // 3. Transfer Payout to User
        if payout > 0 {
            let payout_cpi_accounts = Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.user_token_account.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            };
            let payout_cpi_ctx = CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), payout_cpi_accounts, signer_seeds);
            token::transfer(payout_cpi_ctx, payout)?;
        }

        Ok(())
    }
}

fn add_shares(book: &mut OrderBook, user: Pubkey, yes: u64, no: u64) {
    if let Some(bal) = book.balances.iter_mut().find(|b| b.user == user) {
        bal.yes_shares += yes;
        bal.no_shares += no;
    } else {
        book.balances.push(UserBalance {
            user,
            yes_shares: yes,
            no_shares: no,
        });
    }
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + MarketConfig::INIT_SPACE,
        seeds = [b"config"],
        bump,
    )]
    pub config: Account<'info, MarketConfig>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeOrderBook<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    pub match_state: Account<'info, MatchState>,
    #[account(init, payer = user, space = 8 + OrderBook::INIT_SPACE)]
    pub order_book: Account<'info, OrderBook>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeMatch<'info> {
    #[account(init, payer = user, space = 8 + MatchState::INIT_SPACE)]
    pub match_state: Account<'info, MatchState>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        seeds = [b"config"],
        bump,
    )]
    pub config: Account<'info, MarketConfig>,

    #[account(
        seeds = [b"vault_auth", match_state.key().as_ref()],
        bump,
    )]
    /// CHECK: PDA authority for vault
    pub vault_authority: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PlaceOrder<'info> {
    #[account(mut)]
    pub match_state: Account<'info, MatchState>,
    #[account(
        mut,
        has_one = match_state @ ErrorCode::OrderBookMismatch,
    )]
    pub order_book: Account<'info, OrderBook>,
    #[account(
        seeds = [b"config"],
        bump,
    )]
    pub config: Account<'info, MarketConfig>,
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        address = config.treasury_token_account @ ErrorCode::InvalidFeeAccount,
    )]
    pub treasury_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = vault.owner == vault_authority.key() @ ErrorCode::VaultOwnerMismatch,
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        seeds = [b"vault_auth", match_state.key().as_ref()],
        bump = match_state.vault_authority_bump,
    )]
    /// CHECK: PDA authority for vault
    pub vault_authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ResolveMatch<'info> {
    #[account(mut)]
    pub match_state: Account<'info, MatchState>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub match_state: Account<'info, MatchState>,
    #[account(
        mut,
        has_one = match_state @ ErrorCode::OrderBookMismatch,
    )]
    pub order_book: Account<'info, OrderBook>,
    #[account(
        seeds = [b"config"],
        bump,
    )]
    pub config: Account<'info, MarketConfig>,
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub treasury_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub market_maker_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = vault.owner == vault_authority.key() @ ErrorCode::VaultOwnerMismatch,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        seeds = [b"vault_auth", match_state.key().as_ref()],
        bump = match_state.vault_authority_bump,
    )]
    /// CHECK: PDA authority for vault
    pub vault_authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CancelOrder<'info> {
    #[account(mut)]
    pub match_state: Account<'info, MatchState>,
    #[account(
        mut,
        has_one = match_state @ ErrorCode::OrderBookMismatch,
    )]
    pub order_book: Account<'info, OrderBook>,
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = vault.owner == vault_authority.key() @ ErrorCode::VaultOwnerMismatch,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        seeds = [b"vault_auth", match_state.key().as_ref()],
        bump = match_state.vault_authority_bump,
    )]
    /// CHECK: PDA authority for vault
    pub vault_authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[account]
#[derive(InitSpace)]
pub struct MatchState {
    pub is_open: bool,
    pub winner: u8, // 0 = none, 1 = YES, 2 = NO
    pub next_order_id: u64,
    pub vault_authority_bump: u8,
    pub authority: Pubkey, // Who can resolve this match
}

#[account]
#[derive(InitSpace)]
pub struct MarketConfig {
    pub authority: Pubkey,
    pub treasury_token_account: Pubkey,
    pub market_maker_token_account: Pubkey,
    pub trading_fee_bps: u16,
    pub winnings_fee_bps: u16,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace)]
pub struct UserBalance {
    pub user: Pubkey,
    pub yes_shares: u64,
    pub no_shares: u64,
}

#[account]
#[derive(InitSpace)]
pub struct OrderBook {
    pub match_state: Pubkey, // Tie order book to its match
    #[max_len(256)]
    pub balances: Vec<UserBalance>,
    #[max_len(1024)]
    pub orders: Vec<Order>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
pub struct Order {
    pub id: u64,
    pub maker: Pubkey,
    pub is_buy: bool,
    pub price: u16,
    pub amount: u64,
    pub filled: u64,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Match is closed")]
    MatchClosed,
    #[msg("Match is still open")]
    MatchStillOpen,
    #[msg("Invalid price")]
    InvalidPrice,
    #[msg("Nothing to claim")]
    NothingToClaim,
    #[msg("Order not found")]
    OrderNotFound,
    #[msg("Not the order maker")]
    NotOrderMaker,
    #[msg("Order is already fully filled")]
    AlreadyFilled,
    #[msg("Cost is zero, amount too small")]
    CostTooLow,
    #[msg("Unauthorized to resolve match")]
    UnauthorizedResolver,
    #[msg("Order book does not belong to this match")]
    OrderBookMismatch,
    #[msg("Vault owner does not match expected authority")]
    VaultOwnerMismatch,
    #[msg("Invalid fee account provided for treasury or market maker")]
    InvalidFeeAccount,
    #[msg("Invalid fee basis points")]
    InvalidFeeBps,
}
