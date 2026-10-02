// Store settings. Paste your Stripe Payment Links here after creating them.
// Stripe dashboard → Product catalog → Payment Links → New → copy the link (https://buy.stripe.com/...).
// In each link's "After payment" settings, choose "Don't show confirmation page" and redirect to:
//   https://wordsmiths-gambit.vercel.app/thanks.html?tier=base   (or ?tier=supporter)
// Leave a URL empty and its button scrolls to the pricing section instead.
export const STORE = {
  provider: "stripe",
  products: {
    base: {
      name: "Wordsmith's Gambit",
      price: "$9.99",
      checkoutUrl: "https://buy.stripe.com/eVqeVf4265W0fWC8Q28ww0f",
    },
    supporter: {
      name: "Supporter Edition",
      price: "$29.99",
      checkoutUrl: "https://buy.stripe.com/fZu7sN0PUbgk4dUaYa8ww0g",
    },
  },
  // Download links shown on thanks.html after payment (e.g. itch.io, Google Drive, or Dropbox links).
  downloads: { base: "", supporter: "" },
  supportEmail: "nomadconsulting7@gmail.com",
  // Supabase project "wordsmiths-gambit". The publishable key is safe to ship: the site can only
  // INSERT into wg_subscribers / wg_events (row-level security), never read them.
  supabase: {
    url: "https://cymytecpabikdcihmqdq.supabase.co",
    key: "sb_publishable_h6xTxgosJccjW4wbiNG_KA_IvJUg3TH",
  },
};
