export function toContractPolicy(p) {
    return {
        daily_limit: p.dailyYocto.toString(), weekly_limit: p.weeklyYocto.toString(),
        monthly_limit: p.monthlyYocto.toString(), max_transaction: p.maxTxYocto.toString(),
        allowed_recipients: p.allowedRecipients,
    };
}
