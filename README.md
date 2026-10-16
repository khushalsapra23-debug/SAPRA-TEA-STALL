# SAPRA-TEA-STALL

## Staff login (4-digit PIN)

The staff login page asks for a 4-digit PIN only. Add the PINs as one secret,
separated by commas. A name before a colon is only a label for you:

    npx wrangler secret put STAFF_LOGINS
    # then type e.g.  ravi:1234,amit:5678,sapra:4321

Ravi enters 1234, Amit enters 5678. Every PIN must be different.
ADMIN_PASSWORD, if set, also works as a PIN, so set it to 4 digits or delete it.
To remove someone, delete their entry from STAFF_LOGINS and save the secret again.

Deploy with `npm run deploy`.

## Festival Special

Staff dashboard > Festival tab: add gift items with a photo, description and price, edit or hide them, and set the
section title (e.g. "Diwali Special"). Photos are shrunk in the browser and stored in the D1 database. The `festival`
table is created automatically the first time it is used. The section shows on the website only while at least one
item is switched on.

The Festival section is OFF by default. Use the ON/OFF button at the top of the Festival tab to show it during a
festival and hide it afterwards (your items stay saved). Contact name (Ekta) and phone (7011875287) are editable there.

## Festival page (separate from the home page)

Festivals live on their own page, `/festival.html`. The home page only shows a small banner and a menu link to it
while the festival is ON. Customers pick items with a quantity stepper (1, 2, 3 ...), enter name and phone, and place
the order. Festival orders appear in the staff Orders tab with an order ID starting `FS` and the festival name in front
of the items. Payment is at the shop, same as the normal menu. The festival name is editable, so it works for any
festival (Diwali, Raksha Bandhan, Holi, Eid, Christmas and so on).

## Festival name, "Gifts coming soon" and auto pause

**Festival we are targeting.** Staff dashboard > Festival: type the festival name (e.g. Diwali) in the "Festival we are
targeting" box and press Save. Customers see it highlighted in bold on the festival page and in the home banner.

**After the festival.** Press "Turn OFF (festival over)". The Gifts tab stays in the menu and the page shows
"Gifts will be available soon" (with the next festival name if you typed one). Your items stay saved. Turn the festival
ON again when the next festival starts.

**Auto pause by time.** Both Shop and Festival have an "Auto pause by time" box. Tick "Use auto pause", choose the
"Pause at" and "Resume at" times (India time, works across midnight, e.g. pause 11:00 PM, resume 10:00 AM) and press Save.
Every day, orders stop at the pause time and open again at the resume time by themselves. Customers see
"Orders are paused for now. We will start taking orders again at ...". The manual Pause buttons still work at any time.

**Menu tabs.** The Menu / Contact tabs now scroll to the right place, even when opened from another page.
