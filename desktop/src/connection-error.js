/**
 * Turns an opaque connection failure into something a person can act on.
 *
 * Every way of getting the Server URL wrong — https:// against a plain-http server, a
 * server that was never started, a typo'd host, a blocked port — arrives from `fetch()`
 * as the identical message "fetch failed". That is useless as a status line: it names
 * neither the cause nor the fix. Node keeps the real reason on `err.cause`, so classify
 * on that and say what to change.
 *
 * Returns a single sentence (occasionally two) meant to be shown verbatim in the UI.
 */

/** Host:port for messages, falling back to the raw string when the URL will not parse. */
function hostLabel(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return u.port ? `${u.hostname}:${u.port}` : u.hostname;
  } catch {
    return rawUrl;
  }
}

function isHttps(rawUrl) {
  try {
    return new URL(rawUrl).protocol === 'https:';
  } catch {
    return false;
  }
}

/** The same address with the scheme flipped to http://, for a "try this instead" hint. */
function asHttp(rawUrl) {
  try {
    const u = new URL(rawUrl);
    u.protocol = 'http:';
    return u.toString().replace(/\/$/, '');
  } catch {
    return rawUrl;
  }
}

export function describeFetchError(err, rawUrl = '') {
  const cause = err?.cause;
  const code = cause?.code || err?.code;
  const name = err?.name;
  const where = hostLabel(rawUrl);

  // AbortSignal.timeout() rejects with a TimeoutError, which has no `cause`.
  if (name === 'TimeoutError' || code === 'ABORT_ERR') {
    return `No answer from ${where} within the timeout. The host may be unreachable from this network, or a firewall may be dropping the connection.`;
  }

  switch (code) {
    case 'ECONNREFUSED':
      // By far the most common: the port is right but nothing is behind it.
      return `Nothing is listening on ${where}. Start the team server (docker compose up -d) or check the port.`;

    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return `Cannot resolve the host in ${where}. Check the spelling, and whether you need to be on the VPN.`;

    // A TLS handshake against a server speaking plain HTTP. This is what you get from
    // https://localhost:4000 when mailman is serving http on 4000.
    case 'EPROTO':
    case 'ERR_SSL_WRONG_VERSION_NUMBER':
    case 'ERR_SSL_PACKET_LENGTH_TOO_LONG':
      return `${where} answered without TLS, so it is not an https server. Use ${asHttp(rawUrl)} instead.`;

    case 'CERT_HAS_EXPIRED':
      return `The TLS certificate for ${where} has expired.`;

    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'SELF_SIGNED_CERT_IN_CHAIN':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
      return `The TLS certificate for ${where} is not trusted by this machine (self-signed or an unknown internal CA).`;

    case 'ECONNRESET':
      return `${where} closed the connection unexpectedly.${isHttps(rawUrl) ? ` If it serves plain HTTP, use ${asHttp(rawUrl)}.` : ''}`;

    case 'ERR_INVALID_URL':
      return `"${rawUrl}" is not a valid URL.`;

    default:
      break;
  }

  const detail = cause?.message || err?.message || 'Connection failed.';
  // Never let the bare "fetch failed" through on its own; it tells the user nothing.
  return detail === 'fetch failed' ? `Could not reach ${where}. ${detail}` : detail;
}
