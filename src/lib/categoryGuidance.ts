/** Shared category hints for rule engine and AI prompts (India-first personal papers). */
export const CATEGORY_GUIDANCE_TEXT = `Vault categories (pick exactly one):
Insurance/Vehicle — motor policies, RC, PUC; OD / TP / comprehensive; insurers (Digit, HDFC Ergo, ICICI Lombard, Bajaj Allianz, etc.)
Insurance/Health — health insurance, MediAssist, cashless, hospital bills tied to cover
Insurance/Home — home / property insurance
Insurance/Life — life / term policies
Banking — bank statements (SBI, HDFC, ICICI, Axis, Bank of Baroda, Kotak, etc.), passbooks, loan statements
Tax — Form 16, ITR, 26AS, AIS, TDS certificates, GST returns
Identity — Aadhaar, PAN, passport, driving licence (DL), voter ID
Bills — utilities (electricity, water, gas), mobile (Airtel, Jio), broadband, credit-card statements
Warranties — receipts, invoices for purchases, product warranties
Travel — tickets, boarding passes, PNR, IRCTC, hotel confirmations, visas
Other — anything that does not fit above (not promos)

Use sender domains and filenames when body text is thin (e.g. @hdfcbank.com → Banking, form16.pdf → Tax).
Salary slips and payslips → Tax (or Banking if clearly a bank letter only).
Standalone medical prescriptions / lab reports without insurance → Insurance/Health when clearly health-related.
Never invent vehicle registration numbers — extract only when visible in the document.`;