/* Hindi for the shopping screens (blueprint stage 12). A toggle in the header switches the store between English and
 * Hindi. Text is written in English in the app; this file swaps known phrases for Hindi as screens are drawn, and puts
 * the English back when the shopper switches again. Product names, brands and seller names stay as the seller wrote them.
 * Studio and the seller tools stay in English. */
'use strict';

const HI = {
  // Header, strip and footer
  'Sign in': 'साइन इन करें', Orders: 'ऑर्डर', Wishlist: 'विशलिस्ट', Bag: 'बैग', Search: 'खोजें', Everywhere: 'हर जगह', Deals: 'डील्स',
  'Search for products, brands and more': 'प्रोडक्ट, ब्रांड और बहुत कुछ खोजें', 'Search products': 'प्रोडक्ट खोजें', 'Search in category': 'कैटेगरी में खोजें',
  'Deliver to:': 'डिलीवरी:', 'add PIN code': 'पिन कोड डालें', 'Your account': 'आपका खाता', Categories: 'कैटेगरी',
  'Express delivery in 90 minutes in 8 cities | Free delivery above ₹499 | 10-day returns': '8 शहरों में 90 मिनट में एक्सप्रेस डिलीवरी | ₹499 से ऊपर फ्री डिलीवरी | 10 दिन में वापसी',
  'Quality products, fair prices and reliable delivery across India.': 'पूरे भारत में अच्छे प्रोडक्ट, सही दाम और भरोसेमंद डिलीवरी।',
  'Email address for offers': 'ऑफ़र के लिए ईमेल पता', Subscribe: 'सब्सक्राइब करें', Shop: 'खरीदारी', Help: 'मदद', Bazaario: 'बाज़ारियो',
  'New arrivals': 'नए प्रोडक्ट', 'Most loved': 'सबसे पसंदीदा', 'Track an order': 'ऑर्डर ट्रैक करें', 'Help centre': 'मदद केंद्र',
  'Returns & refunds': 'वापसी और रिफ़ंड', 'Shipping & delivery': 'शिपिंग और डिलीवरी', Cancellations: 'रद्द करना', 'Grievance Officer': 'शिकायत अधिकारी',
  'Get the app': 'ऐप पाएँ', 'Our story': 'हमारी कहानी', 'Sell on Bazaario': 'बाज़ारियो पर बेचें', 'Partner shops': 'पार्टनर दुकानें',
  'Resell and earn': 'रीसेल करें और कमाएँ', Careers: 'करियर', Privacy: 'गोपनीयता', Terms: 'शर्तें', 'Sale events': 'सेल', 'Refer and earn': 'रेफ़र करें और कमाएँ',
  '© 2026 Bazaario · Made in India · All prices include GST': '© 2026 बाज़ारियो · भारत में बना · सभी दामों में GST शामिल',
  'Opening the bazaar…': 'बाज़ार खुल रहा है…',
  // Categories
  Mobiles: 'मोबाइल', Electronics: 'इलेक्ट्रॉनिक्स', Fashion: 'फ़ैशन', 'Home & Kitchen': 'घर और रसोई', Books: 'किताबें', Beauty: 'ब्यूटी',
  'Sports & Fitness': 'खेल और फ़िटनेस', 'Toys & Games': 'खिलौने और गेम', Grocery: 'किराना', Appliances: 'उपकरण',
  // Home
  'Everything your home needs, delivered.': 'घर की हर ज़रूरत, आपके दरवाज़े तक।', 'Shop deals': 'डील्स देखें', 'Shop the sale': 'सेल में खरीदें',
  'Everyday prices': 'रोज़ के दाम',
  'Handpicked brands, honest prices and doorstep delivery across India. New here? Take 10% off with': 'चुने हुए ब्रांड, सही दाम और पूरे भारत में घर तक डिलीवरी। नए हैं? 10% छूट पाएँ',
  'Festive prices on phones, fashion, home and more, for ten days.': 'फ़ोन, फ़ैशन, घर और बहुत कुछ पर दस दिन तक त्योहार के दाम।',
  'Salary day treats for three days. Plus members shop a day early.': 'तीन दिन तक सैलरी डे ऑफ़र। प्लस सदस्य एक दिन पहले खरीदें।', 'Shop by category': 'कैटेगरी के अनुसार खरीदें', 'Browse all departments': 'सभी विभाग देखें',
  'Deals of the day': 'आज की डील्स', 'Limited-time offers': 'सीमित समय के ऑफ़र', 'View all': 'सभी देखें', 'Highest rated products': 'सबसे अच्छी रेटिंग वाले प्रोडक्ट',
  'Recently viewed': 'हाल ही में देखे', 'Based on your browsing': 'आपकी ब्राउज़िंग के आधार पर', 'Free delivery, every day': 'हर दिन फ्री डिलीवरी',
  'Genuine brands': 'असली ब्रांड', 'Bazaario Plus': 'बाज़ारियो प्लस', 'Refer and earn ₹100': 'रेफ़र करें और ₹100 कमाएँ',
  'Your bazaar, personalised': 'आपका अपना बाज़ार', 'Sign in for saved bags, wishlists and order tracking.': 'सेव किए बैग, विशलिस्ट और ऑर्डर ट्रैकिंग के लिए साइन इन करें।',
  'Create account': 'खाता बनाएँ', 'Sale on now': 'सेल चालू है', 'Coming soon': 'जल्द आ रहा है', 'Plus early access': 'प्लस अर्ली एक्सेस',
  'See what is coming': 'देखें क्या आ रहा है', Everything: 'सब कुछ', Ended: 'समाप्त',
  // Product card and page
  'Add to bag': 'बैग में डालें', 'Buy now': 'अभी खरीदें', Deal: 'डील', 'Bazaario Assured': 'बाज़ारियो एश्योर्ड', Assured: 'एश्योर्ड', Sponsored: 'प्रायोजित',
  'Express delivery available': 'एक्सप्रेस डिलीवरी उपलब्ध', 'Out of stock': 'स्टॉक में नहीं', 'In stock': 'स्टॉक में है', Check: 'जाँचें',
  'Enter PIN code': 'पिन कोड डालें', 'Delivery PIN code': 'डिलीवरी पिन कोड', 'Read reviews': 'रिव्यू पढ़ें', Highlights: 'ख़ास बातें',
  'Product details': 'प्रोडक्ट की जानकारी', 'Offers for you': 'आपके लिए ऑफ़र', 'What shoppers say': 'खरीदार क्या कहते हैं', 'Recent reviews': 'हाल के रिव्यू',
  'You may also like': 'आपको यह भी पसंद आ सकता है', 'out of 5': '5 में से', 'Share your experience': 'अपना अनुभव बताएँ', Headline: 'शीर्षक',
  'Your review': 'आपका रिव्यू', 'Post review': 'रिव्यू पोस्ट करें', 'Verified buyer': 'सत्यापित खरीदार', Home: 'होम', Quantity: 'मात्रा',
  'Sold by ': 'विक्रेता: ', 'Ships today or tomorrow': 'आज या कल शिप होगा', 'Cash on Delivery available': 'कैश ऑन डिलीवरी उपलब्ध',
  'Free delivery': 'फ्री डिलीवरी', 'Cash on Delivery': 'कैश ऑन डिलीवरी', 'Secure payment': 'सुरक्षित भुगतान', '10-day returns': '10 दिन में वापसी',
  'Express near you': 'आपके पास एक्सप्रेस', 'Add from this shop': 'इस दुकान से डालें', Brand: 'ब्रांड', Manufacturer: 'निर्माता', 'Country of origin': 'मूल देश',
  'Best before': 'इससे पहले उपयोग करें', 'Sold and shipped by Bazaario': 'बाज़ारियो द्वारा बेचा और भेजा गया',
  // Search
  Filters: 'फ़िल्टर', Delivery: 'डिलीवरी', 'Delivery tomorrow': 'कल डिलीवरी', 'Include in-stock only': 'सिर्फ़ स्टॉक वाले', Category: 'कैटेगरी',
  'Any category': 'कोई भी कैटेगरी', Rating: 'रेटिंग', Brands: 'ब्रांड', Price: 'दाम', Go: 'जाएँ', Offers: 'ऑफ़र', 'Deals only': 'सिर्फ़ डील्स',
  'Clear all filters': 'सभी फ़िल्टर हटाएँ', 'Sort by:': 'क्रम:', Recommended: 'सुझाए गए', 'Price: Low to High': 'दाम: कम से ज़्यादा',
  'Price: High to Low': 'दाम: ज़्यादा से कम', 'Avg. Customer Review': 'औसत रिव्यू', 'Newest Arrivals': 'नए प्रोडक्ट', Discount: 'छूट',
  'No products found': 'कोई प्रोडक्ट नहीं मिला', 'All products': 'सभी प्रोडक्ट', 'Browse deals': 'डील्स देखें', Min: 'न्यूनतम', Max: 'अधिकतम',
  '‹ Previous': '‹ पिछला', 'Next ›': 'अगला ›',
  // Bag and checkout
  'Your bag': 'आपका बैग', 'Bag summary': 'बैग का सारांश', Checkout: 'चेकआउट', 'Save for later': 'बाद के लिए सेव करें', Remove: 'हटाएँ',
  'Move to bag': 'बैग में डालें', 'Your bag is empty': 'आपका बैग खाली है', 'Browse our deals to find something you like.': 'अपनी पसंद की चीज़ ढूँढने के लिए डील्स देखें।',
  'Free delivery on orders above ₹499': '₹499 से ऊपर के ऑर्डर पर फ्री डिलीवरी', 'Your order qualifies for free delivery': 'आपके ऑर्डर पर डिलीवरी फ्री है',
  'Free delivery with Bazaario Plus': 'बाज़ारियो प्लस के साथ फ्री डिलीवरी', 'Secure checkout · UPI, cards and Cash on Delivery': 'सुरक्षित चेकआउट · UPI, कार्ड और कैश ऑन डिलीवरी',
  'Sign in to keep your bag on every device.': 'हर डिवाइस पर अपना बैग रखने के लिए साइन इन करें।', 'Saved for later': 'बाद के लिए सेव',
  'Where should we deliver?': 'कहाँ डिलीवर करें?', 'When should it arrive?': 'कब पहुँचना चाहिए?', 'How would you like to pay?': 'भुगतान कैसे करेंगे?',
  'Your items': 'आपके आइटम', 'Order summary': 'ऑर्डर का सारांश', 'Place your order': 'ऑर्डर करें', 'Items:': 'आइटम:', 'Delivery:': 'डिलीवरी:',
  Free: 'फ्री', 'Free with Plus': 'प्लस के साथ फ्री', 'To pay': 'भुगतान करना है', 'Sale savings:': 'सेल की बचत:', 'Express delivery:': 'एक्सप्रेस डिलीवरी:',
  'Express delivery (Plus):': 'एक्सप्रेस डिलीवरी (प्लस):', 'Order total:': 'ऑर्डर कुल:', 'From wallet:': 'वॉलेट से:', Apply: 'लागू करें',
  'Apply a coupon': 'कूपन लगाएँ', 'Enter coupon code': 'कूपन कोड डालें', 'UPI (Google Pay, PhonePe, Paytm and more)': 'UPI (Google Pay, PhonePe, Paytm और अन्य)',
  'Credit or debit card': 'क्रेडिट या डेबिट कार्ड', 'No-cost EMI on credit card': 'क्रेडिट कार्ड पर बिना ब्याज EMI', 'Use Bazaario wallet': 'बाज़ारियो वॉलेट इस्तेमाल करें',
  'UPI ID': 'UPI आईडी', 'Card number': 'कार्ड नंबर', Expiry: 'समाप्ति', 'Your package': 'आपका पैकेज', Express: 'एक्सप्रेस', Standard: 'स्टैंडर्ड',
  '+ Add a new address': '+ नया पता जोड़ें', 'Placing your order…': 'ऑर्डर हो रहा है…', 'Delivery & payment': 'डिलीवरी और भुगतान', 'Order placed': 'ऑर्डर हो गया',
  'Express item': 'एक्सप्रेस आइटम', 'Pay with cash or UPI when your order is delivered.': 'ऑर्डर मिलने पर नकद या UPI से भुगतान करें।',
  'You will receive a payment request on your UPI app.': 'आपके UPI ऐप पर भुगतान का अनुरोध आएगा।',
  // Orders, account
  'My account': 'मेरा खाता', 'Sign out': 'साइन आउट', 'Profile & security': 'प्रोफ़ाइल और सुरक्षा', Addresses: 'पते', Wallet: 'वॉलेट',
  'Track, return or buy again': 'ट्रैक करें, लौटाएँ या फिर से खरीदें', 'Name, mobile number and password': 'नाम, मोबाइल नंबर और पासवर्ड',
  'Manage delivery addresses': 'डिलीवरी के पते बदलें', 'Things you have saved': 'आपकी सेव की गई चीज़ें', 'Refunds, rewards and balance': 'रिफ़ंड, इनाम और बैलेंस',
  'Questions and your requests': 'सवाल और आपके अनुरोध', 'Free delivery on every order': 'हर ऑर्डर पर फ्री डिलीवरी', 'You and a friend get ₹100 each': 'आपको और दोस्त को ₹100-₹100',
  'Your orders': 'आपके ऑर्डर', 'Payment summary': 'भुगतान का सारांश', 'Order total': 'ऑर्डर कुल', 'Delivering to': 'डिलीवरी का पता', Items: 'आइटम',
  'Item(s) Subtotal:': 'आइटम का योग:', 'Saved with Plus:': 'प्लस से बचत:', Profile: 'प्रोफ़ाइल', Name: 'नाम', Email: 'ईमेल', 'Mobile number': 'मोबाइल नंबर',
  Save: 'सेव करें', 'Change password': 'पासवर्ड बदलें', 'Offers and reminders': 'ऑफ़र और रिमाइंडर',
  'Tell me about price drops, items back in stock and things left in my bag': 'दाम घटने, स्टॉक में वापस आने और बैग में छूटी चीज़ों के बारे में बताएँ',
  'Your name': 'आपका नाम', Password: 'पासवर्ड', 'Re-enter password': 'पासवर्ड दोबारा डालें', 'Invite code': 'इनवाइट कोड', Optional: 'वैकल्पिक',
  'Create your account': 'अपना खाता बनाएँ', 'Already have an account? ': 'पहले से खाता है? ', 'Welcome back': 'फिर से स्वागत है',
  // Plus
  'Choose your plan': 'अपना प्लान चुनें', Yearly: 'सालाना', Monthly: 'मासिक', ' / year': ' / साल', ' / month': ' / महीना', 'Pay with': 'भुगतान का तरीका',
  'Free delivery on everything, and the best sales first.': 'हर चीज़ पर फ्री डिलीवरी, और सबसे अच्छी सेल सबसे पहले।', 'How much Plus saves': 'प्लस से कितनी बचत',
  'Members-only coupons': 'सिर्फ़ सदस्यों के कूपन', 'Plus member': 'प्लस सदस्य', 'Your benefits': 'आपके फ़ायदे', Payments: 'भुगतान', 'Renew automatically': 'अपने आप रिन्यू करें',
  'Sign in first. Plus is linked to your account.': 'पहले साइन इन करें। प्लस आपके खाते से जुड़ा है।',
  // Refer
  'Your invite code': 'आपका इनवाइट कोड', 'Your invite link': 'आपका इनवाइट लिंक', Copy: 'कॉपी करें', 'Share on WhatsApp': 'WhatsApp पर शेयर करें',
  'More ways to share': 'शेयर करने के और तरीके', 'How it works': 'यह कैसे काम करता है', 'Friends joined': 'जुड़े दोस्त', 'You earned': 'आपकी कमाई',
  'Your friends': 'आपके दोस्त', Friend: 'दोस्त', Joined: 'जुड़े', Status: 'स्थिति', Rewarded: 'इनाम मिला',
  'No one has joined with your code yet.': 'अभी तक कोई आपके कोड से नहीं जुड़ा।',
  // Category hubs
  'Top rated': 'सबसे अच्छी रेटिंग', 'Biggest savings': 'सबसे ज़्यादा बचत', 'Good picks that cost less': 'कम दाम में अच्छे विकल्प',
  'The most off the MRP right now': 'अभी MRP पर सबसे ज़्यादा छूट', 'Tip: ': 'सुझाव: ',
  // Help and misc
  'Page not found': 'पेज नहीं मिला', 'Something went wrong': 'कुछ गड़बड़ हो गई', 'Go to home page': 'होम पेज पर जाएँ', Yes: 'हाँ', Cancel: 'रद्द करें',
  'Save PIN': 'पिन सेव करें', Sales: 'सेल', 'No sales right now': 'अभी कोई सेल नहीं',
};

// Phrases with numbers or names in them.
const HI_UNITS = (t) => t.replace(/(\d+) days?/g, '$1 दिन').replace(/(\d+) h\b/g, '$1 घंटे').replace(/(\d+) min\b/g, '$1 मिनट');
const HI_PATTERNS = [
  [/^Only (\d+) left$/, 'केवल $1 बचे'],
  [/^Save (₹[\d,.]+) · (\d+)%$/, '$1 की बचत · $2%'],
  [/^Qty (\d+)$/, 'मात्रा $1'],
  [/^Hi, (.+)$/, 'नमस्ते, $1'],
  [/^(\d+)% off$/, '$1% छूट'],
  [/^Up to (\d+)% off$/, '$1% तक छूट'],
  [/^(\d+) products$/, '$1 प्रोडक्ट'],
  [/^ends in (.+)$/, (_, t) => `समाप्त होने में ${HI_UNITS(t)}`],
  [/^Ends in (.+)$/, (_, t) => `समाप्त होने में ${HI_UNITS(t)}`],
  [/^starts in (.+)$/, (_, t) => `शुरू होने में ${HI_UNITS(t)}`],
  [/^Starts in (.+)$/, (_, t) => `शुरू होने में ${HI_UNITS(t)}`],
  [/^(.+) price$/, '$1 दाम'],
  [/^You save (₹[\d,.]+) on this order$/, 'इस ऑर्डर पर आपकी बचत $1'],
  [/^Sale prices save you (₹[\d,.]+)$/, 'सेल दामों से बचत $1'],
  [/^You're (₹[\d,.]+) away from free delivery$/, 'फ्री डिलीवरी के लिए $1 और'],
  [/^Items \((\d+)\)$/, 'आइटम ($1)'],
  [/^Free delivery by (.+)$/, 'फ्री डिलीवरी $1 तक'],
  [/^Showing (\d+)–(\d+) of (\d+) products$/, '$3 में से $1–$2 प्रोडक्ट'],
  [/^(\d+)★ & above$/, '$1★ और ऊपर'],
  [/^Join Plus for (₹[\d,.]+)$/, '$1 में प्लस से जुड़ें'],
  [/^Shop all (.+)$/, (_, c) => `सभी ${HI[c] || c} देखें`],
  [/^Buying guide: (.+)$/, (_, c) => `खरीदारी गाइड: ${HI[c] || c}`],
  [/^Under (₹[\d,.]+)$/, '$1 से कम'],
  [/^Best reviewed in (.+)$/, (_, c) => `${HI[c] || c} में सबसे अच्छे रिव्यू`],
  [/^More from (.+)$/, (_, c) => `${HI[c] || c} से और`],
  [/^Filters \((\d+)\)$/, 'फ़िल्टर ($1)'],
  [/^Arrives (.+)$/, 'पहुँचेगा: $1'],
  [/^([\d,]+)\+ bought this month$/, 'इस महीने $1+ ने खरीदा'],
  [/^Usual price (₹[\d,.]+)\. The discount is on us; the seller is paid in full\.$/, 'सामान्य दाम $1। छूट हमारी ओर से है; विक्रेता को पूरा भुगतान मिलता है।'],
  [/^Inclusive of GST · or (₹[\d,.]+)\/month with no-cost EMI$/, 'GST सहित · या बिना ब्याज EMI पर $1/महीना'],
  [/^Express delivery in (\d+) cities$/, '$1 शहरों में एक्सप्रेस डिलीवरी'],
  [/^(.+): Plus early access$/, '$1: प्लस अर्ली एक्सेस'],
  [/^(\d+)% off when the sale opens$/, 'सेल शुरू होने पर $1% छूट'],
  [/^Sold by$/, 'विक्रेता'],
];

const i18n = {
  lang: (() => { try { return localStorage.getItem('bz_lang') === 'hi' ? 'hi' : 'en'; } catch { return 'en'; } })(),
  busy: false,
};

function hiText(en) {
  const key = en.trim();
  if (!key) return null;
  if (HI[key]) return en.replace(key, HI[key]);
  for (const [re, to] of HI_PATTERNS) if (re.test(key)) return en.replace(key, key.replace(re, to));
  return null;
}

const SKIP = 'script, style, textarea, [data-no-i18n], .pcard .title, .pdp-title, .line-title, .brand';
function translateNode(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    const parent = node.parentElement;
    if (!parent || parent.closest(SKIP)) return;
    const en = node.__en ?? node.nodeValue;
    const hi = hiText(en);
    if (hi !== null && node.nodeValue !== hi) { node.__en = en; node.__hi = hi; node.nodeValue = hi; }
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE || node.closest(SKIP)) return;
  for (const attr of ['placeholder', 'aria-label', 'title']) {
    if (!node.hasAttribute(attr)) continue;
    const key = `__en_${attr}`;
    const en = node[key] ?? node.getAttribute(attr);
    const hi = hiText(en);
    if (hi !== null) { node[key] = en; node.setAttribute(attr, hi); }
  }
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) translateNode(n);
    else if (n.hasAttribute('placeholder') || n.hasAttribute('aria-label') || n.hasAttribute('title')) {
      for (const attr of ['placeholder', 'aria-label', 'title']) {
        if (!n.hasAttribute(attr) || n.closest(SKIP)) continue;
        const key = `__en_${attr}`;
        const en = n[key] ?? n.getAttribute(attr);
        const hi = hiText(en);
        if (hi !== null) { n[key] = en; n.setAttribute(attr, hi); }
      }
    }
  }
}

function restoreEnglish(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = walker.currentNode; n; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) { if (n.__en !== undefined) { n.nodeValue = n.__en; delete n.__en; delete n.__hi; } continue; }
    for (const attr of ['placeholder', 'aria-label', 'title']) {
      const key = `__en_${attr}`;
      if (n[key] !== undefined) { n.setAttribute(attr, n[key]); delete n[key]; }
    }
  }
}

const observer = new MutationObserver((records) => {
  if (i18n.lang !== 'hi' || i18n.busy) return;
  i18n.busy = true;
  try {
    for (const r of records) {
      // A text that changed by itself (a countdown, say) is new English; our own Hindi writes are skipped.
      if (r.type === 'characterData' && r.target.nodeValue !== r.target.__hi) { r.target.__en = undefined; translateNode(r.target); }
      for (const n of r.addedNodes) translateNode(n);
    }
  } finally { i18n.busy = false; }
});

function setLang(lang) {
  i18n.lang = lang;
  try { localStorage.setItem('bz_lang', lang); } catch { /* private mode */ }
  document.documentElement.lang = lang === 'hi' ? 'hi-IN' : 'en-IN';
  const btn = document.getElementById('lang-btn');
  if (btn) {
    btn.textContent = lang === 'hi' ? 'English' : 'हिन्दी';
    btn.setAttribute('aria-label', lang === 'hi' ? 'Switch to English' : 'हिन्दी में देखें');
    btn.lang = lang === 'hi' ? 'en' : 'hi';
  }
  if (lang === 'hi') {
    i18n.busy = true;
    try { translateNode(document.body); } finally { i18n.busy = false; }
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  } else {
    observer.disconnect();
    restoreEnglish(document.body);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('lang-btn');
  if (btn) btn.addEventListener('click', () => setLang(i18n.lang === 'hi' ? 'en' : 'hi'));
  setLang(i18n.lang);
});
