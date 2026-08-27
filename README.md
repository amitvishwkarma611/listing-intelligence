# Listing Intelligence V10 — Claim Guard + Local History

V10 is the testing-focused build.

## New
### Claim Guard
Scans generated title/description/attributes for risky unsupported claim wording such as:
- 100%
- food grade
- antibacterial
- waterproof
- medical grade
- dermatologically tested
- lifetime
- chemical free

It compares detected phrases against seller-provided verified data and marks REVIEW when a risky phrase is unsupported.

This is a conservative guard, not a legal/compliance certification.

### Local Listing History
The browser stores the last 30 test results in localStorage:
- product name
- timestamp
- score
- generated title

This is local to the browser and is intended only as a lightweight testing history.

## Current goal
Stop adding major features and test the system with real products.

Suggested first test:
1. Silicone body scrubber
2. Upload 3-5 real images
3. Enter only facts you verified
4. Paste marketplace-suggested keywords
5. Run AI
6. Inspect Product Understanding, Keyword Priority, Query Simulation, Claim Guard and final listing
7. Copy the output and compare it with your current listing.

Do not publish automatically from this tool.
