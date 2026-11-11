// Picks the shop's INITIAL selling price for a supplier product. Prices can be changed in the admin panel afterwards.
//
//   lowest   (default) the lower of the supplier's public price and the price it shows to resellers — so the supplier's own
//                      website can never undercut the shop — and never below the supplier's minimum selling price
//   reseller           the price the supplier shows to a signed-in reseller
//   public             the price on the public product page
//
// Whatever the policy, the result is raised to the minimum selling price when the supplier publishes one (selling below it
// is not allowed for resellers). Returns { price, source } or null when the supplier gave no usable price.
export function chooseSellingPrice({ policy = 'lowest', publicPrice = null, resellerPrice = null, minPrice = null }) {
    const pos = (n) => (Number.isFinite(n) && n > 0 ? n : null);
    const pub = pos(publicPrice), res = pos(resellerPrice), min = pos(minPrice);
    let price, source;
    if (policy === 'public') [price, source] = [pub ?? res, pub ? 'public' : 'reseller'];
    else if (policy === 'reseller') [price, source] = [res ?? pub, res ? 'reseller' : 'public'];
    else if (pub && res) [price, source] = pub < res ? [pub, 'public'] : [res, res === pub ? 'both' : 'reseller'];
    else [price, source] = [pub ?? res, pub ? 'public' : 'reseller'];
    if (price === null || price === undefined) return null;
    if (min && price < min) return { price: min, source: 'minimum' };
    return { price, source };
}
