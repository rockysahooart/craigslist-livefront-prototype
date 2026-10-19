/* Sample data. One record per listing, reused on cards, map, previews, details and counts.
   All listings, coordinates and vehicle fields are fictional sample content, not verified seller information.
   Search is case-insensitive and treats "Volkswagen" as "VW"; Newest = most recently posted (fewest minutes); price limits are inclusive. */
window.CL_DATA = (function () {
  // minutes: exact posting age, so Newest keeps the drawn orders within the same displayed hour.
  // mapPx: ILLUSTRATIVE neighbourhood positions on the supplied metro map (image pixels), not real addresses.
  // year / make / model: taken from each listing title (sample values). null = the seller didn't state it.
  // photo: card thumbnail, map preview AND details photo (the same image, so the same car everywhere).
  // Vehicle photos are AI-generated sample images (see assets/img/SOURCES.md). L02 keeps the designed no-photo state.
  const listings = [
    { id: 'L01', title: '2016 VW Golf', year: 2016, make: 'Volkswagen', model: 'Golf', price: 8900, miles: 92000, seller: 'Owner', hours: 1, minutes: 60, area: 'Northeast', category: 'cars-trucks', photo: 'assets/img/L01-gallery-1.jpg', mapPx: [626, 854] },
    { id: 'L02', title: '2019 VW Golf SE', year: 2019, make: 'Volkswagen', model: 'Golf', price: 13900, miles: 41000, seller: 'Dealer', hours: 2, minutes: 110, area: 'Edina', category: 'cars-trucks', photo: null, mapPx: [470, 1040] },
    { id: 'L03', title: '2015 VW Golf', year: 2015, make: 'Volkswagen', model: 'Golf', price: 7500, miles: 112000, seller: 'Owner', hours: 2, minutes: 120, area: 'St. Paul', category: 'cars-trucks', photo: 'assets/img/L03-card.jpg', mapPx: [802, 947] },
    { id: 'L04', title: '2017 VW Golf', year: 2017, make: 'Volkswagen', model: 'Golf', price: 9600, miles: 98000, seller: 'Dealer', hours: 3, minutes: 175, area: 'Richfield', category: 'cars-trucks', photo: 'assets/img/L04-card.jpg', mapPx: [586, 1059] },
    { id: 'L05', title: '2014 VW Golf', year: 2014, make: 'Volkswagen', model: 'Golf', price: 6800, miles: 128000, seller: 'Owner', hours: 4, minutes: 230, area: 'Bloomington', category: 'cars-trucks', photo: 'assets/img/L05-card.jpg', mapPx: [569, 1126] },
    { id: 'L06', title: '2018 Honda Civic', year: 2018, make: 'Honda', model: 'Civic', price: 12500, miles: 78000, seller: 'Dealer', hours: 2, minutes: 105, area: 'St. Paul', category: 'cars-trucks', photo: 'assets/img/L06-card.jpg', mapPx: [835, 915] },
    { id: 'L07', title: '2015 Subaru Outback', year: 2015, make: 'Subaru', model: 'Outback', price: 9800, miles: 104000, seller: 'Owner', hours: 3, minutes: 170, area: 'Richfield', category: 'cars-trucks', photo: 'assets/img/L07-card.jpg', mapPx: [600, 1072] },
    { id: 'L08', title: '2017 Toyota RAV4', year: 2017, make: 'Toyota', model: 'RAV4', price: 14900, miles: 105000, seller: 'Dealer', hours: 4, minutes: 220, area: 'Bloomington', category: 'cars-trucks', photo: 'assets/img/L08-card.jpg', mapPx: [580, 1140] },
    { id: 'L09', title: 'Mid-century dresser', year: null, make: null, model: null, price: 240, miles: null, detail: 'Walnut, 6 drawers', seller: null, hours: 2, minutes: 100, area: 'Northeast', category: 'furniture', photo: 'assets/img/L09-card.jpg', mapPx: [652, 818] },
    // Added fictional listings that exercise filter edge cases.
    { id: 'L10', title: '2013 Ford Focus', year: 2013, make: 'Ford', model: 'Focus', price: 5900, miles: null, seller: 'Owner', hours: 5, minutes: 300, area: 'Uptown', category: 'cars-trucks', photo: 'assets/img/L10-card.jpg', mapPx: [572, 938] },          // mileage not listed
    { id: 'L11', title: '2016 VW Jetta', year: 2016, make: 'Volkswagen', model: 'Jetta', price: 8400, miles: 100000, seller: 'Dealer', hours: 5, minutes: 320, area: 'Roseville', category: 'cars-trucks', photo: 'assets/img/L11-card.jpg', mapPx: [772, 796] },     // exactly 100,000 mi
    { id: 'L12', title: '2012 Honda Accord', year: 2012, make: 'Honda', model: 'Accord', price: 10000, miles: 150000, seller: 'Owner', hours: 6, minutes: 360, area: 'Maple Grove', category: 'cars-trucks', photo: 'assets/img/L12-card.jpg', mapPx: [395, 770] }, // exactly $10,000
    { id: 'L13', title: 'Toyota Tacoma pickup', year: null, make: 'Toyota', model: 'Tacoma', price: 11500, miles: 140000, seller: 'Owner', hours: 6, minutes: 380, area: 'Blaine', category: 'cars-trucks', photo: 'assets/img/L13-card.jpg', mapPx: [640, 632] }     // year not listed
  ];
  listings.forEach(l => { if (!l.detail) l.detail = l.miles != null ? `${l.miles.toLocaleString('en-US')} miles` : 'Mileage not listed'; });

  // Seller-provided content. Facts not supplied by a seller show "Not provided".
  const factLabels = ['Mileage', 'Condition', 'Transmission', 'Fuel', 'Title status', 'Body type'];
  const details = {
    L01: {
      title: '2016 Volkswagen Golf',
      // Figma designed "Photo 1 of 6"; only one consistent view of this car exists, so the count is 1.
      facts: { Mileage: '92,000 miles', Condition: 'Good', Transmission: 'Automatic', Fuel: 'Gas', 'Title status': 'Clean', 'Body type': 'Hatchback' },
      description: "Daily driver, always garaged in winter. Recent oil change and new front brake pads in August. Two keys and the owner's manual included. Small scratch on the rear bumper. Non-smoking owner. Message me with questions or to arrange a time to see it.",
      pickupMap: true
    },
    L02: { title: '2019 Volkswagen Golf SE', facts: { Mileage: '41,000 miles' }, description: '2019 Golf SE for sale. Message for details.' }
  };

  // Recent searches (S05) with their stored scopes.
  const recentSeed = [
    { query: 'Cars', scope: { category: 'all' } },
    { query: 'Volkswagen Golf', scope: { category: 'cars-trucks' } },
    { query: '', scope: { category: 'cars-trucks' } },
    { query: 'Honda Civic', scope: { category: 'cars-trucks', price: { min: null, max: 12000 } } },
    { query: 'Mid-century dresser', scope: { category: 'furniture', radius: 10 } },
    { query: 'Toyota RAV4', scope: { category: 'cars-trucks' } }
  ];

  // Search centres: 55401 from the handoff; the others are ILLUSTRATIVE neighbourhood centres on the same map.
  const locations = [
    { id: 'mpls', label: 'Minneapolis', zip: '55401', px: [601, 898] },
    { id: 'stpaul', label: 'St. Paul', zip: '55102', px: [815, 925] },
    { id: 'edina', label: 'Edina', zip: '55424', px: [505, 1040] },
    { id: 'bloomington', label: 'Bloomington', zip: '55420', px: [590, 1170] }
  ];
  const radii = [5, 10, 25, 50];
  const PX_PER_MILE = 571.6 / 25;   // 25 miles = 571.6 image px (handoff scale)

  const sorts = [
    { id: 'newest', label: 'Newest' },
    { id: 'price-asc', label: 'Price: low to high' },
    { id: 'price-desc', label: 'Price: high to low' }
  ];
  const sellers = [{ id: null, label: 'All' }, { id: 'Owner', label: 'Owner' }, { id: 'Dealer', label: 'Dealer' }];
  const mileages = [{ id: null, label: 'Any' }, { id: 100000, label: 'Under 100,000 mi' }];
  const yearBounds = { min: 1990, max: 2026 };

  // Makes and models offered = those present in the dataset (so every option can match something).
  const makes = {};
  listings.filter(l => l.make).forEach(l => { (makes[l.make] = makes[l.make] || new Set()).add(l.model); });
  const makeModels = Object.fromEntries(Object.keys(makes).sort().map(k => [k, [...makes[k]].sort()]));

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
  const forSaleIds = ['cars-trucks', 'auto-parts', 'motorcycles', 'bikes', 'furniture', 'electronics', 'free'];

  const categoryKeywords = { 'car': 'cars-trucks', 'cars': 'cars-trucks', 'truck': 'cars-trucks', 'trucks': 'cars-trucks', 'cars & trucks': 'cars-trucks', 'cars and trucks': 'cars-trucks' };

  return { listings, factLabels, details, recentSeed, locations, radii, PX_PER_MILE, sorts, sellers, mileages, yearBounds, makeModels, categories, forSaleIds, categoryKeywords };
})();
