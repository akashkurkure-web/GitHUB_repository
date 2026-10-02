# Bazaario Design System

Bazaario should look **professional, compact and trustworthy**: clean white surfaces, a single sans-serif typeface, square-ish corners and tight, consistent spacing.
It must also stay **visually distinct from Amazon** (dark navy header, yellow and orange buttons) and Flipkart (blue and yellow).
Every rule below can be checked against a screen.

---

## 1. Principles

| Do | Don't |
|---|---|
| Information-dense, scannable layouts | Large empty gaps and oversized hero sections |
| Text labels for navigation and actions | Decorative emoji or icons next to labels |
| One clear primary action per view | Several competing coloured buttons |
| Plain, professional wording ("Deals", "Checkout") | Playful or slang copy |

## 2. Colour

| Token | Hex | Use |
|---|---|---|
| `--paper` | `#F6F5F2` | Page background (neutral warm grey) |
| `--surface` | `#FFFFFF` | Cards, header, panels |
| `--ink` | `#1F1D1A` | Body text, prices |
| `--ink-soft` | `#625D57` | Secondary text, labels |
| `--teal` | `#0F5E5B` | Brand: logo, links, rating badge, secondary buttons, footer |
| `--clay` | `#B8482E` | **Primary action only** (Add to bag, Checkout, Place order) and the "Deal" tag |
| `--leaf` | `#2F7D4F` | Savings, in stock, success |
| `--saffron` | `#F2B544` | Focus ring only |
| `--line` / `--line-strong` | `#E3E0DA` / `#D2CEC6` | Borders and dividers |

- Exactly **one clay button** per view. Every other button is a teal outline or plain.
- No yellow or orange buttons and no dark navy header.
- Discounts are shown as **green "Save ₹X · N%"** text, never as a red "−N%".

## 3. Typography

- **One typeface: Inter** (self-hosted), with weights 400, 500, 600 and 700. No serif or display fonts, and no italics for decoration.
- Sizes: base **14px**; h1 22px; h2 18px; h3 15px; small/meta 12px; section labels 11px uppercase.
- Headings use weight 600. Prices use weight 700 with tabular figures.

## 4. Shape and depth

| Element | Radius |
|---|---|
| Buttons, inputs, tags, chips | **4px** |
| Cards, panels, images | **6px** (images 4px) |
| Avatars, stepper dots | Circle (the only round elements) |

- Separate surfaces with **1px borders**, not floating shadows. A shadow appears only on hover (product cards) and on popovers (search suggestions, dialogs, toasts).

## 5. Spacing (compact)

| Use | Value |
|---|---|
| Between sections | 24px |
| Grid gap (product cards, tiles) | 12px (8px on mobile) |
| Card padding | 16px (product cards 8px) |
| Control height | 36px (small 28px) |
| Header padding | 8px 20px |

Spacing scale: **4 · 8 · 12 · 16 · 24 · 32**. Don't use values outside this scale.

## 6. Icons

- **Allowed:** product images, the ★ inside rating badges and the star-rating input, and the ♡ wishlist toggle on product images.
- **Not allowed:** emoji or icons in the header, navigation, buttons, headings, trust badges, empty states, account tiles or alerts. Use text.

## 7. Layout signatures

| Area | Pattern |
|---|---|
| Top strip | Thin teal bar: service promises (left), "Deliver to: PIN" (right) |
| Header | White; logo, square search field with category selector and teal Search button, text links (Sign in · Orders · Wishlist · Bag with count) |
| Category nav | Text tabs on white with an underline on hover; "Deals" in clay |
| Home | Compact hero card (headline, two buttons, three product tiles), category text tiles, product grids with a section header and "View all" |
| Product card | Image, Deal tag, wishlist toggle, brand (uppercase), 2-line title, rating badge, price + MRP + green savings, delivery line, outline "Add to bag" |
| Product page | Image column (max 420px) + info column with a bordered purchase panel |
| Checkout | Three-step progress (Bag → Delivery & payment → Order placed), numbered sections, sticky order summary |
| Admin (Bazaario Studio) | Underlined tabs, bordered stat tiles, bordered tables |

## 8. Vocabulary

| Use | Avoid |
|---|---|
| Bag, Add to bag, Checkout | Cart, Proceed to Buy |
| Deals, Deals of the day | Today's Deals, Bazaar steals |
| Sign in / Hi, Priya | Hello, sign in / Account & Lists |
| Orders, My account | Returns & Orders, Your Account |
| Verified buyer | Verified Purchase |
| Bazaario Studio | Seller Central |

## 9. Accessibility

- Contrast: ink on paper 15.6:1; white on clay 5.2:1; white on teal 7.6:1; soft ink on paper above 4.5:1.
- Visible 2px saffron focus ring on every interactive element.
- Layouts work from 360px width.

## 10. Review checklist

1. Is there exactly one clay button on the screen?
2. Are there any decorative icons or emoji outside product images, ratings and the wishlist toggle? (There should be none.)
3. Are button and input corners 4px, and card corners 6px?
4. Do gaps follow the 4/8/12/16/24 scale, with sections 24px apart?
5. Is all text in Inter and all copy from the vocabulary table?
