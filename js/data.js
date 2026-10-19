/* Sample data (prototype update handoff). One record per listing, reused on cards, map and details.
   Search is case-insensitive and treats "Volkswagen" as "VW"; Newest = fewest hours; max price inclusive. */
window.CL_DATA = (function () {
  // minutes: exact posting age, so Newest keeps the drawn orders within the same displayed hour.
  // mapPx: approximate neighbourhood positions on the supplied metro map (image pixels).
  // photo: card thumbnail AND details photo 1 (the same image by spec).
  const listings = [
    { id: 'L01', title: '2016 VW Golf', price: 8900, miles: 92000, detail: '92,000 miles', seller: 'Owner', hours: 1, minutes: 60, area: 'Northeast', category: 'cars-trucks', photo: 'assets/img/L01-gallery-1.jpg', mapPx: [626, 854] },
    { id: 'L02', title: '2019 VW Golf SE', price: 13900, miles: 41000, detail: '41,000 miles', seller: 'Dealer', hours: 2, minutes: 110, area: 'Edina', category: 'cars-trucks', photo: null, mapPx: [470, 1040] },
    { id: 'L03', title: '2015 VW Golf', price: 7500, miles: 112000, detail: '112,000 miles', seller: 'Owner', hours: 2, minutes: 120, area: 'St. Paul', category: 'cars-trucks', photo: 'assets/img/L03-card.jpg', mapPx: [802, 947] },
    { id: 'L04', title: '2017 VW Golf', price: 9600, miles: 98000, detail: '98,000 miles', seller: 'Dealer', hours: 3, minutes: 175, area: 'Richfield', category: 'cars-trucks', photo: 'assets/img/L04-card.jpg', mapPx: [586, 1059] },
    { id: 'L05', title: '2014 VW Golf', price: 6800, miles: 128000, detail: '128,000 miles', seller: 'Owner', hours: 4, minutes: 230, area: 'Bloomington', category: 'cars-trucks', photo: 'assets/img/L05-card.jpg', mapPx: [569, 1126] },
    { id: 'L06', title: '2018 Honda Civic', price: 12500, miles: 78000, detail: '78,000 miles', seller: 'Dealer', hours: 2, minutes: 105, area: 'St. Paul', category: 'cars-trucks', photo: 'assets/img/L06-card.jpg', mapPx: [835, 915] },
    { id: 'L07', title: '2015 Subaru Outback', price: 9800, miles: 104000, detail: '104,000 miles', seller: 'Owner', hours: 3, minutes: 170, area: 'Richfield', category: 'cars-trucks', photo: 'assets/img/L07-card.jpg', mapPx: [586, 1059] },
    { id: 'L08', title: '2017 Toyota RAV4', price: 14900, miles: 105000, detail: '105,000 miles', seller: 'Dealer', hours: 4, minutes: 220, area: 'Bloomington', category: 'cars-trucks', photo: 'assets/img/L08-card.jpg', mapPx: [569, 1126] },
    { id: 'L09', title: 'Mid-century dresser', price: 240, miles: null, detail: 'Walnut, 6 drawers', seller: null, hours: 2, minutes: 100, area: 'Northeast', category: 'furniture', photo: 'assets/img/L09-card.jpg', mapPx: [652, 818] }
  ];

  // Cars & trucks browsing with no query shows this drawn set (spec): Golf, Civic, Outback, RAV4.
  const browseIds = ['L01', 'L06', 'L07', 'L08'];

  // Seller-provided content. Facts not supplied by a seller show "Not provided".
  const factLabels = ['Mileage', 'Condition', 'Transmission', 'Fuel', 'Title status', 'Body type'];
  const details = {
    L01: {
      title: '2016 Volkswagen Golf',
      photoCount: 6, // designed "Photo 1 of 6"; only photo 1 exists
      facts: { Mileage: '92,000 miles', Condition: 'Good', Transmission: 'Automatic', Fuel: 'Gas', 'Title status': 'Clean', 'Body type': 'Hatchback' },
      description: "Daily driver, always garaged in winter. Recent oil change and new front brake pads in August. Two keys and the owner's manual included. Small scratch on the rear bumper (photo 5). Non-smoking owner. Message me with questions or to arrange a time to see it.",
      pickupMap: true
    },
    L02: {
      title: '2019 Volkswagen Golf SE',
      facts: { Mileage: '41,000 miles' },
      description: '2019 Golf SE for sale. Message for details.'
    }
  };

  // Recent searches (S05). Only scopes the prototype can show are runnable; the others stay unavailable.
  const recentSeed = [
    { query: 'Volkswagen Golf', scope: { category: 'cars-trucks' } },
    { query: '', scope: { category: 'cars-trucks' } },
    { query: 'Honda Civic', scope: { category: 'cars-trucks', price: { min: null, max: 12000 } } },
    { query: 'Mid-century dresser', scope: { category: 'furniture', radius: 10 }, unavailable: true },
    { query: 'Toyota RAV4', scope: { category: 'cars-trucks' } }
  ];

  const location = { label: 'Minneapolis', zip: '55401', px: [601, 898] }; // fixed
  const radius = 25;                                                         // fixed, miles
  const PX_PER_MILE = 571.6 / 25;                                            // 25 miles = 571.6 image px

  const sellers = [{ id: null, label: 'All' }, { id: 'Owner', label: 'Owner' }, { id: 'Dealer', label: 'Dealer' }];
  const mileages = [{ id: null, label: 'Any' }, { id: 100000, label: 'Under 100,000 mi' }];

  const categories = {
    top: { id: 'all', label: 'All categories' },
    forSale: [
      { id: 'all-for-sale', label: 'All for sale' },
      { id: 'cars-trucks', label: 'Cars & trucks' },
      { id: 'auto-parts', label: 'Auto parts' },
      { id: 'motorcycles', label: 'Motorcycles' },
      { id: 'bikes', label: 'Bikes' },
      { id: 'furniture', label: 'Furniture' },
      { id: 'electronics', label: 'Electronics' },
      { id: 'free', label: 'Free' },
      { id: 'more-for-sale', label: 'More for sale categories', chevron: true, last: true }
    ],
    other: [
      { id: 'housing', label: 'Housing', chevron: true },
      { id: 'jobs', label: 'Jobs', chevron: true },
      { id: 'services', label: 'Services', chevron: true },
      { id: 'community', label: 'Community', chevron: true },
      { id: 'gigs', label: 'Gigs', chevron: true },
      { id: 'resumes', label: 'Resumes', chevron: true, last: true }
    ]
  };

  // Category keywords: typing "cars" opens Cars & trucks browsing (earlier prototype request, kept).
  const categoryKeywords = { 'car': 'cars-trucks', 'cars': 'cars-trucks', 'truck': 'cars-trucks', 'trucks': 'cars-trucks', 'cars & trucks': 'cars-trucks', 'cars and trucks': 'cars-trucks' };

  return { listings, browseIds, factLabels, details, recentSeed, location, radius, PX_PER_MILE, sellers, mileages, categories, categoryKeywords };
})();
