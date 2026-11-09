/// Never follow redirects on gateway HTTP calls. In addition to bearer tokens and
/// password/PKCE bodies, these clients carry cookies and X-Hermes-Session-Token,
/// which reqwest's cross-origin sensitive-header stripping does not protect.
/// This also prevents HTTPS-to-HTTP downgrades; callers must use the final URL.
pub(crate) fn client_builder() -> reqwest::blocking::ClientBuilder {
    reqwest::blocking::Client::builder().redirect(reqwest::redirect::Policy::none())
}

/// Reject redirects as well as HTTP errors, without exposing bodies or URL secrets.
pub(crate) fn require_success(
    response: reqwest::blocking::Response,
) -> Result<reqwest::blocking::Response, String> {
    if response.status().is_success() {
        Ok(response)
    } else {
        Err(format!(
            "Hermes gateway returned HTTP {}. Check the configured final gateway URL; redirects are not followed.",
            response.status()
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        thread,
        time::Duration,
    };

    #[test]
    fn require_success_accepts_only_2xx_without_leaking_secrets() {
        for status in [200, 201, 204, 299, 301, 302, 303, 304, 307, 308, 400, 401, 500] {
            let source = TcpListener::bind("127.0.0.1:0").unwrap();
            let origin = format!("http://{}", source.local_addr().unwrap());
            let server = thread::spawn(move || {
                let (mut stream, _) = source.accept().unwrap();
                stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
                let mut request = [0; 4096];
                assert!(stream.read(&mut request).unwrap() > 0);
                write!(stream, "HTTP/1.1 {status} Test\r\nLocation: /secret-location\r\nContent-Length: 11\r\nConnection: close\r\n\r\nsecret-body").unwrap();
            });
            let response = client_builder().no_proxy()
                .timeout(Duration::from_secs(5)).build().unwrap()
                .get(format!("{origin}/?token=secret-token"))
                .send().unwrap();
            let result = require_success(response);
            assert_eq!(result.is_ok(), (200..300).contains(&status), "{status}");
            if let Err(error) = result {
                assert!(error.contains(&format!("HTTP {status}")));
                assert!(error.contains("final gateway URL"));
                assert!(!error.contains("secret"));
            }
            server.join().unwrap();
        }
    }

    #[test]
    fn gateway_clients_do_not_forward_credentials_on_redirects() {
        // Cross-port is cross-origin. Cover GET headers and POST bodies, including
        // redirects that preserve the method/body. No external services required.
        for status in [301, 302, 303, 307, 308] {
            for post in [false, true] {
                let target = TcpListener::bind("127.0.0.1:0").unwrap();
                target.set_nonblocking(true).unwrap();
                let source = TcpListener::bind("127.0.0.1:0").unwrap();
                let origin = format!("http://{}", source.local_addr().unwrap());
                let location = format!("http://{}/capture", target.local_addr().unwrap());
                let server = thread::spawn(move || {
                    let (mut stream, _) = source.accept().unwrap();
                    stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
                    let mut request = Vec::new();
                    let mut buffer = [0u8; 4096];
                    loop {
                        let count = stream.read(&mut buffer).unwrap();
                        assert!(count > 0);
                        request.extend_from_slice(&buffer[..count]);
                        let text = String::from_utf8_lossy(&request);
                        if text.contains("\r\n\r\n") && (!post || text.contains("secret-code")) {
                            break;
                        }
                    }
                    let text = String::from_utf8_lossy(&request).to_ascii_lowercase();
                    assert!(text.contains("authorization: bearer secret-access"));
                    assert!(text.contains("x-hermes-session-token: secret-session"));
                    assert!(text.contains("cookie: session=secret-cookie"));
                    write!(stream, "HTTP/1.1 {status} Redirect\r\nLocation: {location}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
                });
                let client = client_builder()
                    .timeout(Duration::from_secs(5))
                    .build()
                    .unwrap();
                let request = if post {
                    client.post(&origin).json(&serde_json::json!({
                        "password": "secret-password",
                        "refresh_token": "secret-refresh",
                        "code_verifier": "secret-verifier",
                        "code": "secret-code",
                    }))
                } else {
                    client.get(&origin)
                };
                let response = request
                    .bearer_auth("secret-access")
                    .header("X-Hermes-Session-Token", "secret-session")
                    .header("Cookie", "session=secret-cookie")
                    .send()
                    .unwrap();
                assert_eq!(response.status().as_u16(), status);
                assert_eq!(response.url().as_str(), format!("{origin}/"));
                server.join().unwrap();
                assert_eq!(target.accept().unwrap_err().kind(), std::io::ErrorKind::WouldBlock);
            }
        }
    }
}
