/**
 * social-icons.js — Circular SVG social icons as data URIs.
 * Brand green (#2e9f82) circles with white glyphs.
 * Loaded before email-builder.js so icons are available during event construction.
 *
 * Usage in production emails: swap data URIs for hosted PNGs at
 * https://assets.upnow.ae/email/icon-instagram.png etc. (Gmail blocks data-URIs).
 */
(function (g) {
  'use strict';

  var GREEN = '#2e9f82';

  var IG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">' +
    '<circle cx="14" cy="14" r="14" fill="' + GREEN + '"/>' +
    '<rect x="8.5" y="8.5" width="11" height="11" rx="3.5" fill="none" stroke="#fff" stroke-width="1.6"/>' +
    '<circle cx="14" cy="14" r="2.9" fill="none" stroke="#fff" stroke-width="1.6"/>' +
    '<circle cx="19.8" cy="8.8" r="1.1" fill="#fff"/>' +
    '</svg>';

  var FB =
    '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">' +
    '<circle cx="14" cy="14" r="14" fill="' + GREEN + '"/>' +
    '<path d="M15.9 8H14c-1.6 0-2.6 1-2.6 2.6V12H9.8v2.7h1.6V21h3V14.7h1.9l.7-2.7h-2.6v-1.3c0-.6.3-1 1-1H15.9V8z" fill="#fff"/>' +
    '</svg>';

  var YT =
    '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">' +
    '<circle cx="14" cy="14" r="14" fill="' + GREEN + '"/>' +
    '<rect x="7.5" y="10.5" width="13" height="8" rx="2.2" fill="#fff"/>' +
    '<polygon points="12.2,12.5 18.3,14.5 12.2,16.5" fill="' + GREEN + '"/>' +
    '</svg>';

  function encode(svg) {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  g.UpnowSocialIcons = {
    instagram: encode(IG),
    facebook:  encode(FB),
    youtube:   encode(YT),
  };
})(window);
