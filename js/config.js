// Purchases remain disabled until verified payment handling and fulfillment exist.
// See README.md for release requirements; a redirect is not payment evidence.
export const STORE = {
  provider: "stripe",
  checkoutEnabled: false, // Enable only after verified payment and fulfillment are implemented.
  products: {
    base: {
      name: "Wordsmith's Gambit",
      price: "$9.99",
      checkoutUrl: "",
    },
    supporter: {
      name: "Supporter Edition",
      price: "$29.99",
      checkoutUrl: "",
    },
  },
  // Reserved for a future fulfillment implementation; never expose paid downloads on a public thank-you page.
  downloads: { base: "", supporter: "" },
  supportEmail: "nomadconsulting7@gmail.com",
  // Supabase project "wordsmiths-gambit". The publishable key is safe to ship: the site can only
  // INSERT into wg_subscribers / wg_events (row-level security), never read them.
  supabase: {
    url: "https://cymytecpabikdcihmqdq.supabase.co",
    key: "sb_publishable_h6xTxgosJccjW4wbiNG_KA_IvJUg3TH",
  },
};
