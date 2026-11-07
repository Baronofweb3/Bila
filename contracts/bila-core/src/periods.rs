//! UTC budget periods derived from the block timestamp. No cron, no resets:
//! a counter is simply "stale" once the current period index moves past it.
//!
//! - Day:   calendar day (UTC)
//! - Week:  Monday 00:00 UTC .. Sunday 23:59:59 UTC
//! - Month: calendar month (UTC)

use near_sdk::near;

const NS_PER_DAY: u64 = 86_400 * 1_000_000_000;

#[near(serializers = [borsh])]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Periods {
    pub day: u64,
    pub week: u64,
    pub month: u64,
}

pub fn periods_at(timestamp_ns: u64) -> Periods {
    let day = timestamp_ns / NS_PER_DAY;
    // 1970-01-01 was a Thursday. Shift by 3 so weeks start on Monday.
    let week = (day + 3) / 7;
    let (y, m) = year_month_from_days(day as i64);
    let month = (y as u64) * 12 + (m as u64 - 1);
    Periods { day, week, month }
}

/// Howard Hinnant's civil_from_days, returning (year, month 1..=12).
fn year_month_from_days(z: i64) -> (i64, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ts(days: u64, secs: u64) -> u64 {
        days * NS_PER_DAY + secs * 1_000_000_000
    }

    #[test]
    fn month_boundaries() {
        // 2026-01-31 23:59:59 vs 2026-02-01 00:00:00 (day 20484 = 2026-01-31)
        let jan31 = periods_at(ts(20_484, 86_399));
        let feb1 = periods_at(ts(20_485, 0));
        assert_eq!(jan31.month, 2026 * 12);
        assert_eq!(feb1.month, 2026 * 12 + 1);
        // Leap year: 2028-02-29 is day 21_243, 2028-03-01 is 21_244
        assert_eq!(periods_at(ts(21_243, 0)).month, 2028 * 12 + 1);
        assert_eq!(periods_at(ts(21_244, 0)).month, 2028 * 12 + 2);
    }

    #[test]
    fn weeks_start_monday() {
        // 2026-11-01 = Sunday (day 20_758), 2026-11-02 = Monday (day 20_759)
        let sun = periods_at(ts(20_758, 86_399));
        let mon = periods_at(ts(20_759, 0));
        let next_sun = periods_at(ts(20_765, 86_399));
        assert_eq!(sun.week + 1, mon.week);
        assert_eq!(mon.week, next_sun.week);
    }
}
