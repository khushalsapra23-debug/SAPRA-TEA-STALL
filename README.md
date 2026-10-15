# SAPRA-TEA-STALL

## Staff logins (username + 4-digit PIN)

Add staff as a secret, one `username:PIN` pair each, separated by commas:

    npx wrangler secret put STAFF_LOGINS
    # then type e.g.  ravi:1234,amit:5678,sapra:4321

Usernames are not case-sensitive. The older `ADMIN_PASSWORD` secret still works as username `admin`
(set it to a 4-digit PIN: `npx wrangler secret put ADMIN_PASSWORD`).
To remove someone, delete their pair from `STAFF_LOGINS` and run the command again.

Deploy with `npm run deploy`.
