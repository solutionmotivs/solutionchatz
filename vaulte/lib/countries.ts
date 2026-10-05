// Countries offered at sign-up and in verification forms (ISO 3166-1 alpha-2). Sanctioned jurisdictions are
// intentionally listed so the user gets a clear refusal from the rules engine instead of a missing option.
export const COUNTRIES: Array<[string, string]> = [
  ["IN", "India"], ["US", "United States"], ["GB", "United Kingdom"], ["AE", "United Arab Emirates"], ["SG", "Singapore"],
  ["DE", "Germany"], ["FR", "France"], ["NL", "Netherlands"], ["IE", "Ireland"], ["ES", "Spain"], ["IT", "Italy"], ["PT", "Portugal"],
  ["BE", "Belgium"], ["AT", "Austria"], ["FI", "Finland"], ["SE", "Sweden"], ["DK", "Denmark"], ["NO", "Norway"], ["CH", "Switzerland"],
  ["PL", "Poland"], ["CZ", "Czechia"], ["LU", "Luxembourg"], ["GR", "Greece"], ["EE", "Estonia"], ["LV", "Latvia"], ["LT", "Lithuania"],
  ["CA", "Canada"], ["AU", "Australia"], ["NZ", "New Zealand"], ["JP", "Japan"], ["KR", "South Korea"], ["HK", "Hong Kong"],
  ["MY", "Malaysia"], ["TH", "Thailand"], ["ID", "Indonesia"], ["PH", "Philippines"], ["VN", "Vietnam"], ["LK", "Sri Lanka"],
  ["BD", "Bangladesh"], ["NP", "Nepal"], ["PK", "Pakistan"], ["SA", "Saudi Arabia"], ["QA", "Qatar"], ["KW", "Kuwait"], ["BH", "Bahrain"],
  ["OM", "Oman"], ["EG", "Egypt"], ["ZA", "South Africa"], ["KE", "Kenya"], ["NG", "Nigeria"], ["GH", "Ghana"], ["MX", "Mexico"],
  ["BR", "Brazil"], ["AR", "Argentina"], ["CL", "Chile"], ["CO", "Colombia"], ["TR", "Turkey"], ["IL", "Israel"],
];

export const countryName = (code: string) => COUNTRIES.find(([c]) => c === code)?.[1] ?? code;
