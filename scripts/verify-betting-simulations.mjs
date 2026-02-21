import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const EVM_REPORT = resolve(
  ROOT,
  "packages/evm-contracts/simulations/evm-localnet-pnl.json",
);
const SOLANA_REPORT = resolve(
  ROOT,
  "packages/gold-betting-demo/anchor/simulations/solana-localnet-pnl.json",
);

function asBigInt(value) {
  return BigInt(String(value));
}

function assert(condition, message, errors) {
  if (!condition) {
    errors.push(message);
  }
}

function validateSharedReport(report, label, errors) {
  assert(typeof report.generatedAt === "string", `${label}: missing generatedAt`, errors);
  assert(Number.isInteger(report.wallets), `${label}: wallets must be integer`, errors);
  assert(Number.isInteger(report.rounds), `${label}: rounds must be integer`, errors);
  assert(
    Array.isArray(report.walletPnl),
    `${label}: walletPnl must be an array`,
    errors,
  );
  assert(
    Array.isArray(report.strategyPnl),
    `${label}: strategyPnl must be an array`,
    errors,
  );
  assert(
    Array.isArray(report.roundsSummary),
    `${label}: roundsSummary must be an array`,
    errors,
  );

  if (Array.isArray(report.walletPnl)) {
    assert(
      report.walletPnl.length === report.wallets,
      `${label}: walletPnl length ${report.walletPnl.length} != wallets ${report.wallets}`,
      errors,
    );
    const unique = new Set(report.walletPnl.map((row) => row.address));
    assert(
      unique.size === report.wallets,
      `${label}: unique wallet addresses ${unique.size} != wallets ${report.wallets}`,
      errors,
    );
    for (const row of report.walletPnl) {
      const initial = asBigInt(row.initialBalance);
      const final = asBigInt(row.finalBalance);
      const pnl = asBigInt(row.pnl);
      assert(
        final - initial === pnl,
        `${label}: wallet ${row.address} has inconsistent pnl`,
        errors,
      );
    }
  }

  if (Array.isArray(report.strategyPnl) && Array.isArray(report.walletPnl)) {
    const byStrategy = new Map();
    for (const row of report.walletPnl) {
      if (!byStrategy.has(row.strategy)) {
        byStrategy.set(row.strategy, { total: 0n, wallets: 0, positive: 0 });
      }
      const agg = byStrategy.get(row.strategy);
      const pnl = asBigInt(row.pnl);
      agg.total += pnl;
      agg.wallets += 1;
      if (pnl > 0n) agg.positive += 1;
    }

    for (const strategyRow of report.strategyPnl) {
      const agg = byStrategy.get(strategyRow.strategy) ?? {
        total: 0n,
        wallets: 0,
        positive: 0,
      };
      const average = agg.wallets === 0 ? 0n : agg.total / BigInt(agg.wallets);
      assert(
        strategyRow.wallets === agg.wallets,
        `${label}: ${strategyRow.strategy} wallets mismatch`,
        errors,
      );
      assert(
        asBigInt(strategyRow.totalPnl) === agg.total,
        `${label}: ${strategyRow.strategy} totalPnl mismatch`,
        errors,
      );
      assert(
        asBigInt(strategyRow.averagePnl) === average,
        `${label}: ${strategyRow.strategy} averagePnl mismatch`,
        errors,
      );
      assert(
        strategyRow.positiveWallets === agg.positive,
        `${label}: ${strategyRow.strategy} positiveWallets mismatch`,
        errors,
      );
    }
  }

  if (Array.isArray(report.roundsSummary)) {
    assert(
      report.roundsSummary.length === report.rounds,
      `${label}: roundsSummary length ${report.roundsSummary.length} != rounds ${report.rounds}`,
      errors,
    );
  }
}

function validateEvm(report) {
  const errors = [];
  validateSharedReport(report, "EVM", errors);

  assert(report.wallets === 100, "EVM: wallets must be 100", errors);
  assert(report.rounds === 4, "EVM: rounds must be 4", errors);
  assert(
    report.chainVerification?.verificationPassed === true,
    "EVM: chain verification did not pass",
    errors,
  );
  assert(
    report.chainVerification?.transactionsSubmitted ===
      report.chainVerification?.receiptsVerified,
    "EVM: submitted tx count does not match verified receipts",
    errors,
  );

  if (Array.isArray(report.roundsSummary)) {
    for (const row of report.roundsSummary) {
      assert(
        row.betsPlaced === report.wallets,
        `EVM: round ${row.round} betsPlaced ${row.betsPlaced} != ${report.wallets}`,
        errors,
      );
    }
  }

  const stats = report.executionStats;
  assert(!!stats, "EVM: missing executionStats", errors);
  if (stats) {
    const expectedBetSuccess = report.wallets * report.rounds;
    const expectedClaimSuccess = (report.roundsSummary ?? []).reduce(
      (sum, row) => sum + Number(row.winningClaims ?? 0),
      0,
    );
    assert(
      stats.betSuccess === expectedBetSuccess,
      `EVM: betSuccess ${stats.betSuccess} != expected ${expectedBetSuccess}`,
      errors,
    );
    assert(
      stats.betFailures >= 0,
      `EVM: invalid betFailures ${stats.betFailures}`,
      errors,
    );
    assert(
      stats.betAttempts === stats.betSuccess + stats.betFailures,
      "EVM: betAttempts != betSuccess + betFailures",
      errors,
    );
    assert(
      stats.claimSuccess === expectedClaimSuccess,
      `EVM: claimSuccess ${stats.claimSuccess} != expected ${expectedClaimSuccess}`,
      errors,
    );
    assert(
      stats.claimFailures === 0,
      `EVM: claimFailures ${stats.claimFailures} != 0`,
      errors,
    );
    assert(
      stats.claimAttempts === stats.claimSuccess + stats.claimFailures,
      "EVM: claimAttempts != claimSuccess + claimFailures",
      errors,
    );
  }

  return errors;
}

function validateSolana(report) {
  const errors = [];
  validateSharedReport(report, "Solana", errors);

  assert(report.wallets === 100, "Solana: wallets must be 100", errors);
  assert(report.rounds === 3, "Solana: rounds must be 3", errors);
  assert(
    report.chainVerification?.verificationPassed === true,
    "Solana: chain verification did not pass",
    errors,
  );
  assert(
    report.chainVerification?.signaturesSubmitted ===
      report.chainVerification?.signaturesVerified,
    "Solana: submitted signature count does not match verified signatures",
    errors,
  );

  if (Array.isArray(report.roundsSummary)) {
    for (const row of report.roundsSummary) {
      assert(
        row.betsPlaced === report.wallets,
        `Solana: round ${row.round} betsPlaced ${row.betsPlaced} != ${report.wallets}`,
        errors,
      );
    }
  }

  const stats = report.executionStats;
  assert(!!stats, "Solana: missing executionStats", errors);
  if (stats) {
    const expectedBetSuccess = report.wallets * report.rounds;
    const expectedClaimSuccess = (report.roundsSummary ?? []).reduce(
      (sum, row) => sum + Number(row.winningClaims ?? 0),
      0,
    );
    assert(
      stats.betAttempts === expectedBetSuccess,
      `Solana: betAttempts ${stats.betAttempts} != expected ${expectedBetSuccess}`,
      errors,
    );
    assert(
      stats.betSuccess === expectedBetSuccess,
      `Solana: betSuccess ${stats.betSuccess} != expected ${expectedBetSuccess}`,
      errors,
    );
    assert(
      stats.betFailures === 0,
      `Solana: betFailures ${stats.betFailures} != 0`,
      errors,
    );
    assert(
      stats.claimSuccess === expectedClaimSuccess,
      `Solana: claimSuccess ${stats.claimSuccess} != expected ${expectedClaimSuccess}`,
      errors,
    );
    assert(
      stats.claimFailures === 0,
      `Solana: claimFailures ${stats.claimFailures} != 0`,
      errors,
    );
    assert(
      stats.claimAttempts === stats.claimSuccess + stats.claimFailures,
      "Solana: claimAttempts != claimSuccess + claimFailures",
      errors,
    );
  }

  return errors;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function printResult(label, reportPath, errors, report) {
  const verification =
    report.chainVerification?.transactionsSubmitted !== undefined
      ? `${report.chainVerification.receiptsVerified}/${report.chainVerification.transactionsSubmitted}`
      : `${report.chainVerification?.signaturesVerified}/${report.chainVerification?.signaturesSubmitted}`;
  console.log(`${label}: ${reportPath}`);
  console.log(`  generatedAt: ${report.generatedAt}`);
  console.log(`  chain verification: ${verification}`);
  console.log(`  status: ${errors.length === 0 ? "PASS" : "FAIL"}`);
  if (errors.length > 0) {
    for (const error of errors) {
      console.log(`    - ${error}`);
    }
  }
}

const evmReport = readJson(EVM_REPORT);
const solanaReport = readJson(SOLANA_REPORT);
const evmErrors = validateEvm(evmReport);
const solanaErrors = validateSolana(solanaReport);

printResult("EVM", EVM_REPORT, evmErrors, evmReport);
printResult("Solana", SOLANA_REPORT, solanaErrors, solanaReport);

if (evmErrors.length > 0 || solanaErrors.length > 0) {
  process.exit(1);
}
