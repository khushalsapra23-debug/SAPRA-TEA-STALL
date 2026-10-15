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
