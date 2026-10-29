# API ingress

The API proxy publishes only a loopback listener. Put a host-level HTTPS ingress in front of 127.0.0.1:8082; web and admin use 8080 and 8081. Configure the ingress to preserve Host, overwrite X-Forwarded-Proto with the actual scheme, allow at least 201 MiB request bodies and 650-second upstream timeouts, and disable response buffering for API traffic. Set certificates and DNS outside this repository.

For an ingress running in another container, explicitly configure networking and bind/firewall rules before deployment; its localhost is not the host's localhost. Do not expose these HTTP listeners directly to the internet.

The API proxy overwrites client-supplied forwarding chains with its observed caller. The API trusts forwarded IPs only from exact socket IPs listed in `AUTH_TRUSTED_PROXY_IPS`. Docker proxy addresses can change. Leave this setting empty until the topology is known. For accurate per-client login limits, configure the external ingress and this proxy with a precise trusted-IP/real-IP policy and then set the API's exact proxy socket address. Do not trust whole public networks or arbitrary forwarded headers. Test spoofed forwarding headers in staging. Without this setup clients can share a proxy-IP rate-limit bucket.

The proxy resolves the API service dynamically, so an API container replacement does not leave nginx pointing at its old address. It permits export uploads at the API's 200 MiB product limit plus framing overhead. Most media uploads go directly to signed R2 URLs; R2 CORS must include both frontend origins.
