// GET /api/currencies — public: currencies Vaulte can quote, their decimals, and which are closed (with the reason).
import { apiSuccess } from "@/lib/utils";
import { CURRENCIES, closedCurrencies, currencyStatus } from "@/lib/currency";

export async function GET() {
  const open = Object.values(CURRENCIES).map(c => ({ code: c.code, name: c.name, decimals: c.exp, country: c.country, status: currencyStatus(c.code), note: c.note ?? null }));
  const closed = Array.from(closedCurrencies()).map(code => ({ code, status: "CLOSED", note: "Closed for legal reasons (sanctions perimeter). Opened only after written legal clearance." }));
  return apiSuccess({ currencies: [...open, ...closed], note: "Availability of a pair also depends on the sender's and recipient's countries, the rails the partners offer, and your verification level. Test mode quotes every open pair with simulated partners." });
}
