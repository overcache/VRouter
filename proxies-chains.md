# proxies:

## dns

package => ss-tunnel:5353 => ss-server/ssr-server => 8.8.8.8:53

## ss

- tcp
package => ss-redir:1010 => ss-server

- udp
package => ss-redir:1011 => ss-server

## ssKt

- tcp
package => ss-redir:1012 => kcptun-client:1030 => kcptun-server => ss-server

- udp
package => ss-redir:1011 => ss-server

## ssr

- tcp
package => ss-redir:1020 => ss-server

- udp
package => ss-redir:1021 => ss-server

## ssrKt

- tcp
package => ssr-redir:1022 => kcptun-client:1030 => kcptun-server => ssr-server

- udp
package => ssr-redir:1021 => ssr-server

## http

package => http-proxy =>

## https

package => https-proxy =>
