# Bazaario Design System: "Warm Bazaar"

Bazaario should feel like a **calm, crafted Indian bazaar**: warm cream paper, clay and peacock-teal colours, editorial serif headlines, soft rounded surfaces.
It must **never** be mistaken for Amazon (dark navy bar, yellow and orange buttons, dense grey utility layout) or Flipkart (blue and yellow).
Every rule below is written as **Do / Don't** so that reviewers can check a screen against it.

---

## 1. Personality

| Bazaario is... | ...not |
|---|---|
| Warm, airy, editorial | Dense, utilitarian, "catalog dump" |
| Few, confident choices per screen | Many competing badges and links |
| Friendly words ("bag", "steals") | Retail jargon ("Proceed to Buy", "Account & Lists") |

## 2. Colour

| Token | Hex | Use |
|---|---|---|
| `--paper` | `#FAF6EF` | Page background (warm cream, never grey) |
| `--surface` | `#FFFFFF` | Cards |
| `--ink` | `#221C17` | Text and prices |
| `--ink-soft` | `#6B6158` | Secondary text |
| `--clay` | `#B8482E` | **Primary action** (Add to bag, Checkout, Place order) |
| `--teal` | `#0F5E5B` | Brand colour: logo, links, ratings, footer, secondary buttons |
| `--saffron` | `#F2B544` | Highlights only: "Steal" tags, savings, focus ring |
| `--leaf` | `#2F7D4F` | Success / in stock |
| `--line` | `#EBE3D7` | Hairline borders |

- **Do** use exactly one clay button per view for the main action. All other actions use the teal outline.
- **Don't** use yellow or orange buttons, a navy or black header, or blue links.
- **Don't** colour discounts red. Savings are shown in saffron, never as a red "−57%".

## 3. Typography

| Role | Font | Size / weight |
|---|---|---|
| Display & headings | **Fraunces** (serif) | 40 / 30 / 22 px, weight 600 |
| UI & body | **Manrope** (sans) | 15 px base, weights 400-800 |
| Prices | Manrope 800 | Tabular figures; no superscript ₹ |

- **Do** use the serif for page titles, section headings, product titles on the product page, and the logo.
- **Don't** use the serif in buttons, forms or tables.
- Section headings are sentence case with a short italic tagline, e.g. *"Bazaar steals - handpicked, while stocks last"*.

## 4. Shape, depth, spacing

- Radius: cards **18px**, images **16px**, buttons and inputs **12px**, chips **999px**.
  Buttons are **rounded rectangles, not pills**.
- Depth: one soft shadow, `0 6px 24px rgba(34,28,23,.06)`. Cards lift 2px on hover.
- Spacing scale: 4, 8, 12, 16, 24, 32, 48 px. Sections are separated by **48px** of air, not by grey bands.
- **Don't** use hard 1px grey boxes around everything, or bevelled or gradient buttons.

## 5. Layout signatures (what makes it recognisably Bazaario)

| Area | Bazaario pattern | Avoid (Amazon pattern) |
|---|---|---|
| Header | **Light** cream header; logo, a large centred rounded search, then icon + label links (Account, Orders, Wishlist, Bag) | Dark bar with "Deliver to", "Hello, sign in / Account & Lists", "Returns & Orders" |
| Delivery PIN | Slim announcement strip above the header ("Delivering to 411001 · change") | PIN block inside the header |
| Categories | Scrollable **chip row** with emoji icons under the header | Dark sub-navigation bar of text links |
| Home | **Split hero** (serif headline + CTA on the left, product collage on the right), then a "Shop by category" circle row, then product grids | Full-width rotating carousel with 2x2 category cards overlapping it |
| Product card | Big rounded image, **heart button on the image**, brand above title, teal rating chip "4.4 ★", price + struck MRP + saffron "Save ₹X" | Orange star strings, red "−%" figure, yellow "Add to cart" |
| Product page | **Two columns**: sticky gallery, plus one info column holding a purchase card | Three columns with a separate right-hand buy box |
| Checkout | **Progress stepper** (Bag → Address → Payment → Done) at the top | Numbered grey boxes |
| Footer | Teal footer with a newsletter sign-up and three link columns | "Back to top" band, then four dense link columns |

## 6. Vocabulary

| Use | Instead of |
|---|---|
| Bag, Add to bag, Your bag | Cart, Add to Cart, Shopping Cart |
| Checkout | Proceed to Buy |
| Buy now | Buy Now (title-case buttons) |
| Bazaar steals | Today's Deals |
| Sign in / Hi, Priya | Hello, sign in / Account & Lists |
| Orders | Returns & Orders |
| What shoppers say | Customer reviews |
| Verified buyer | Verified Purchase |
| Bazaario Studio | Seller Central |
| My account | Your Account |

## 7. Components

- **Primary button**: clay background, white text, 12px radius, 44px tall, weight 700; on hover the background darkens 8%.
- **Secondary button**: white with a 1.5px teal border and teal text.
- **Ghost button**: text only, teal.
- **Rating chip**: teal background, white "4.4 ★", followed by the count in `--ink-soft`.
- **Steal tag**: saffron background, ink text, pill, top-left of the image.
- **Inputs**: 12px radius, `--line` border, 44px tall; focus shows a **3px saffron ring**.
- **Toast**: teal, bottom-right, rounded 14px. Errors use clay.

## 8. Imagery & icons

- Product images sit on a soft tinted square (category colour at low saturation) with a 16px radius.
- Icons are emoji or line icons at one consistent size. Never use mixed icon styles in one row.

## 9. Accessibility (non-negotiable)

- Text contrast is at least 4.5:1. Ink on paper is 15.6:1; white on clay is 5.2:1; white on teal is 7.6:1; soft ink on paper is 5.6:1.
- Every interactive element shows the saffron focus ring.
- Tap targets are at least 44px. Layouts work at 360px width.

## 10. Review checklist

Before shipping a screen, check:
1. Is there exactly one clay primary action?
2. Are there any yellow or orange buttons, dark header bars or red discount figures? (There should be none.)
3. Do headings use Fraunces, and do buttons and forms use Manrope?
4. Is the copy from the vocabulary table?
5. Do focus rings and contrast meet section 9?
