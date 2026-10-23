import assert from 'node:assert/strict'
import { organizationDay, offsetDay, dayBoundary, dayEnd } from '../src/lib/organizationTime.ts'
assert.equal(organizationDay('2026-10-22T20:00:00Z','Asia/Kolkata'),'2026-10-23')
assert.equal(organizationDay('2026-10-22T20:00:00Z','America/New_York'),'2026-10-22')
assert.equal(dayBoundary('2026-10-23','Asia/Kolkata'),'2026-10-22T18:30:00.000Z')
assert.equal(offsetDay('2026-01-01',-1),'2025-12-31')
for(const [day,hours] of [['2026-03-08',23],['2026-11-01',25]])assert.equal((new Date(dayEnd(day,'America/New_York'))-new Date(dayBoundary(day,'America/New_York'))+1)/3600000,hours)
console.log('PASS: organization dates, UTC boundaries, day offsets, and 23/25-hour daylight-saving days.')
