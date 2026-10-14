/* Sample data. Listing records follow handoff page F4; one record feeds cards, map, details and counts.
   Additions for the expanded prototype are marked DERIVED and documented in README. */
window.CL_DATA = (function () {
  // minutes: posting age used for exact Newest ordering (F4 shows whole hours only; DERIVED tie-break that
  // keeps the drawn orders: S01 Golf then dresser, S03 Golf then Civic, S06/S09 Golf order).
  // mapPx: metro-map image pixels (F4). L06–L09 are DERIVED from their F4 neighbourhoods.
  const listings = [
    { id: 'L01', title: '2016 VW Golf', price: 8900, miles: 92000, detail: '92,000 miles', seller: 'Owner', hours: 1, minutes: 60, area: 'Northeast', category: 'cars-trucks', photo: 'assets/img/L01-card.jpg', mapPx: [626, 854] },
    { id: 'L02', title: '2019 VW Golf SE', price: 13900, miles: 41000, detail: '41,000 miles', seller: 'Dealer', hours: 2, minutes: 110, area: 'Edina', category: 'cars-trucks', photo: null, mapPx: [511, 1049] },
    { id: 'L03', title: '2015 VW Golf', price: 7500, miles: 112000, detail: '112,000 miles', seller: 'Owner', hours: 2, minutes: 120, area: 'St. Paul', category: 'cars-trucks', photo: 'assets/img/L03-card.jpg', mapPx: [802, 947] },
    { id: 'L04', title: '2017 VW Golf', price: 9600, miles: 98000, detail: '98,000 miles', seller: 'Dealer', hours: 3, minutes: 175, area: 'Richfield', category: 'cars-trucks', photo: 'assets/img/L04-card.jpg', mapPx: [586, 1059] },
    { id: 'L05', title: '2014 VW Golf', price: 6800, miles: 128000, detail: '128,000 miles', seller: 'Owner', hours: 4, minutes: 230, area: 'Bloomington', category: 'cars-trucks', photo: 'assets/img/L05-card.jpg', mapPx: [569, 1126] },
    { id: 'L06', title: '2018 Honda Civic', price: 12500, miles: 78000, detail: '78,000 miles', seller: 'Dealer', hours: 2, minutes: 105, area: 'St. Paul', category: 'cars-trucks', photo: 'assets/img/L06-card.jpg', mapPx: [835, 915] },
    { id: 'L07', title: '2015 Subaru Outback', price: 9800, miles: 104000, detail: '104,000 miles', seller: 'Owner', hours: 3, minutes: 170, area: 'Richfield', category: 'cars-trucks', photo: 'assets/img/L07-card.jpg', mapPx: [612, 1082] },
    { id: 'L08', title: '2017 Toyota RAV4', price: 14900, miles: 105000, detail: '105,000 miles', seller: 'Dealer', hours: 4, minutes: 220, area: 'Bloomington', category: 'cars-trucks', photo: 'assets/img/L08-card.jpg', mapPx: [606, 1160] },
    { id: 'L09', title: 'Mid-century dresser', price: 240, miles: null, detail: 'Walnut, 6 drawers', seller: null, hours: 2, minutes: 100, area: 'Northeast', category: 'furniture', photo: 'assets/img/L09-card.jpg', mapPx: [652, 818] }
  ];

  // Seller-provided content exists only for L01 (frame 18:501). Other listings show F4 fields only.
  const details = {
    L01: {
      title: '2016 Volkswagen Golf',
      gallery: ['assets/img/L01-gallery-1.jpg', 'assets/img/L01-card.jpg'],
      facts: [
        ['Mileage', '92,000 miles'], ['Condition', 'Good'],
        ['Transmission', 'Automatic'], ['Fuel', 'Gas'],
        ['Title status', 'Clean'], ['Body type', 'Hatchback']
      ],
      description: "Daily driver, always garaged in winter. Recent oil change and new front brake pads in August. Two keys and the owner's manual included. Small scratch on the rear bumper (photo 5). Non-smoking owner. Message me with questions or to arrange a time to see it.",
      pickupMap: true
    }
  };

  // Search locations (DERIVED): neighbourhood centres on the supplied metro map, in image px. 55401 is from F4.
  const locations = [
    { id: 'mpls', label: 'Minneapolis', zip: '55401', px: [601, 898] },
    { id: 'stpaul', label: 'St. Paul', zip: '55102', px: [815, 925] },
    { id: 'edina', label: 'Edina', zip: '55424', px: [505, 1040] },
    { id: 'bloomington', label: 'Bloomington', zip: '55420', px: [590, 1170] }
  ];
  const PX_PER_MILE = 571.6 / 25; // F4: 25-mile radius = 571.6 image px
  const radii = [5, 10, 25, 50];

  const sorts = [
    { id: 'newest', label: 'Newest' },
    { id: 'closest', label: 'Closest' },
    { id: 'price-asc', label: 'Price: low to high' },
    { id: 'price-desc', label: 'Price: high to low' }
  ];

  const sellers = [{ id: null, label: 'Any' }, { id: 'Owner', label: 'Owner' }, { id: 'Dealer', label: 'Dealer' }];
  const mileages = [{ id: null, label: 'Any' }, { id: 50000, label: 'Under 50,000' }, { id: 100000, label: 'Under 100,000' }];

  // Recent searches drawn in S05 (seed). Scopes are stored; DERIVED from the scope text shown in the frame.
  const recentSeed = [
    { query: 'Cars', scope: { category: 'all' } },          // added: runs the same search as typing "cars"
    { query: 'Volkswagen Golf', scope: { category: 'cars-trucks' } },
    { query: '', scope: { category: 'cars-trucks' } },
    { query: 'Honda Civic', scope: { category: 'cars-trucks', price: { min: null, max: 12000 } } },
    { query: 'Mid-century dresser', scope: { category: 'furniture', radius: 10 } },
    { query: 'Toyota RAV4', scope: { category: 'cars-trucks' } }
  ];

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
  // "All for sale" contains every for-sale category in the sample data.
  const forSaleIds = ['cars-trucks', 'auto-parts', 'motorcycles', 'bikes', 'furniture', 'electronics', 'free'];

  // Category keywords: typing one of these opens that category's browsing list instead of a title search.
  const categoryKeywords = { 'car': 'cars-trucks', 'cars': 'cars-trucks', 'truck': 'cars-trucks', 'trucks': 'cars-trucks', 'cars & trucks': 'cars-trucks', 'cars and trucks': 'cars-trucks' };

  return { categoryKeywords, listings, details, locations, PX_PER_MILE, radii, sorts, sellers, mileages, recentSeed, categories, forSaleIds };
})();
