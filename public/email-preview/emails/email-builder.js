/**
 * email-builder.js — UpNow Workflow Messages preview engine.
 *
 * Exports window.UpnowEmails = { EVENTS, buildEmail }
 *
 * 13 events × 3 channels (email HTML · push JSON · SMS text).
 * All email HTML is mail-client-safe: 600px table layout, inline styles,
 * Outlook MSO conditionals, Manrope with web-safe fallback.
 *
 * Sample data: Layla Hassan · Marina Vista Residences, Unit 2204 ·
 *              UN-2K26-04812 · AED 142,000/yr · 1 Jun 2026 – 31 May 2027
 */
(function (g) {
  'use strict';

  /* ─── brand tokens ──────────────────────────────────────────────── */
  var C = {
    green:  '#2e9f82',
    greenD: '#1f7e66',
    tint:   '#e7f5f0',
    ink:    '#0e1a16',
    ink2:   '#2b3a34',
    mute:   '#6b7a74',
    line:   '#e6ebe7',
    paper:  '#f3f5f1',
    panel:  '#f8f9f7',
    white:  '#ffffff',
  };

  var FONT = 'Manrope,Arial,Helvetica,sans-serif';

  /* ─── social icon URLs (loaded by social-icons.js before us) ──── */
  var icons = (g.UpnowSocialIcons || { instagram: '', facebook: '', youtube: '' });

  /* ─── low-level email builder ────────────────────────────────── */
  /**
   * buildEmail(opts) → branded transactional HTML string.
   *
   * opts:
   *   preheader  string   Hidden preview text (defaults to spacer)
   *   badge      string   Eyebrow chip, e.g. "Step 2 · Documents"
   *   headline   string   H1 heading
   *   greeting   boolean  Show "Hi Layla," (default true)
   *   body       string   Main paragraph (may contain basic HTML)
   *   details    [{label,value}]  Optional info table rows
   *   ctaText    string   Primary button label
   *   ctaHref    string   Primary button URL
   *   footerNote string   Optional helper line below CTA
   */
  function buildEmail(opts) {
    var o = opts || {};

    var pre = o.preheader
      ? '<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">' + o.preheader + '</div>'
      : '<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">' + '&zwnj;&nbsp;'.repeat ? Array(40).join('&zwnj;&nbsp;') : '' + '</div>';

    var badge = o.badge
      ? '<p style="margin:0 0 14px;font-family:' + FONT + ';font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:' + C.green + ';">' + o.badge + '</p>'
      : '';

    var greeting = (o.greeting !== false)
      ? '<p style="margin:0 0 12px;font-family:' + FONT + ';font-size:15px;color:' + C.ink2 + ';">Hi Layla,</p>'
      : '';

    /* detail rows table */
    var detailRows = '';
    if (o.details && o.details.length) {
      var rows = o.details.map(function (r, i) {
        var border = i > 0 ? 'border-top:1px solid ' + C.line + ';' : '';
        return '<tr>' +
          '<td style="' + border + 'padding:10px 18px;font-family:' + FONT + ';font-size:11.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:' + C.mute + ';width:38%;white-space:nowrap;vertical-align:top;">' + r.label + '</td>' +
          '<td style="' + border + 'padding:10px 18px;font-family:' + FONT + ';font-size:13.5px;font-weight:600;color:' + C.ink + ';vertical-align:top;">' + r.value + '</td>' +
          '</tr>';
      }).join('');
      detailRows = '<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:22px 0 24px;border:1px solid ' + C.line + ';border-radius:10px;overflow:hidden;background:' + C.panel + ';">' + rows + '</table>';
    }

    /* CTA button — using VML fallback for Outlook */
    var cta = '';
    if (o.ctaText) {
      var href = o.ctaHref || '#';
      cta = '<table cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 0;">' +
        '<tr>' +
        '<td style="border-radius:9px;background:' + C.green + ';">' +
        '<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="' + href + '" style="height:48px;v-text-anchor:middle;width:200px;" arcsize="19%" stroke="f" fillcolor="' + C.green + '"><w:anchorlock/><center style="color:#fff;font-family:' + FONT + ';font-size:14px;font-weight:bold;">' + o.ctaText + '</center></v:roundrect><![endif]-->' +
        '<!--[if !mso]><!-->' +
        '<a href="' + href + '" target="_blank" style="display:inline-block;padding:14px 30px;font-family:' + FONT + ';font-size:14px;font-weight:700;color:#fff;text-decoration:none;border-radius:9px;background:' + C.green + ';">' + o.ctaText + '</a>' +
        '<!--<![endif]-->' +
        '</td>' +
        '</tr>' +
        '</table>';
    }

    var footerNote = o.footerNote
      ? '<p style="margin:14px 0 0;font-family:' + FONT + ';font-size:13px;color:' + C.mute + ';line-height:1.55;">' + o.footerNote + '</p>'
      : '';

    var social = '<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin:14px auto 0;">' +
      '<tr>' +
      '<td style="padding:0 6px;"><a href="#" target="_blank"><img src="' + icons.instagram + '" width="28" height="28" alt="Instagram" style="display:block;border:0;outline:none;"></a></td>' +
      '<td style="padding:0 6px;"><a href="#" target="_blank"><img src="' + icons.facebook  + '" width="28" height="28" alt="Facebook"  style="display:block;border:0;outline:none;"></a></td>' +
      '<td style="padding:0 6px;"><a href="#" target="_blank"><img src="' + icons.youtube   + '" width="28" height="28" alt="YouTube"   style="display:block;border:0;outline:none;"></a></td>' +
      '</tr>' +
      '</table>';

    return '<!DOCTYPE html>\n' +
      '<html lang="en">\n' +
      '<head>\n' +
      '<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">\n' +
      '<meta name="viewport" content="width=device-width,initial-scale=1.0">\n' +
      '<meta name="x-apple-disable-message-reformatting">\n' +
      '<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->\n' +
      '<style>\n' +
      '@import url(\'https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700;800&display=swap\');\n' +
      'body{margin:0;padding:0;background:' + C.paper + ';-webkit-text-size-adjust:100%;}\n' +
      '@media(max-width:600px){.ew{width:100%!important}.ep{padding:28px 20px!important}}\n' +
      '</style>\n' +
      '</head>\n' +
      '<body style="margin:0;padding:0;background:' + C.paper + ';">\n' +
      pre + '\n' +
      '<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="background:' + C.paper + ';">\n' +
      '<tr><td align="center" style="padding:28px 16px 48px;">\n' +
      '<!--[if mso]><table cellpadding="0" cellspacing="0" border="0"><tr><td width="600"><![endif]-->\n' +
      '<table class="ew" width="600" cellpadding="0" cellspacing="0" border="0" role="presentation" style="max-width:600px;width:100%;border-radius:14px;overflow:hidden;box-shadow:0 8px 32px rgba(14,26,22,.10);">\n' +

      /* HEADER */
      '<tr><td style="background:' + C.green + ';padding:22px 40px;text-align:center;">\n' +
      '<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin:0 auto;">\n' +
      '<tr>\n' +
      '<td style="background:rgba(255,255,255,.18);border-radius:8px;width:32px;height:32px;text-align:center;vertical-align:middle;line-height:32px;">' +
      '<span style="font-family:' + FONT + ';font-weight:800;font-size:17px;color:#fff;vertical-align:middle;">U</span>' +
      '</td>\n' +
      '<td style="padding-left:9px;vertical-align:middle;">' +
      '<span style="font-family:' + FONT + ';font-size:18px;font-weight:800;color:#fff;letter-spacing:-.3px;">UpNow</span>' +
      '</td>\n' +
      '</tr>\n' +
      '</table>\n' +
      '</td></tr>\n' +

      /* BODY */
      '<tr><td class="ep" style="background:' + C.white + ';padding:36px 40px 32px;">\n' +
      badge +
      '<h1 style="margin:0 0 18px;font-family:' + FONT + ';font-size:22px;font-weight:800;color:' + C.ink + ';letter-spacing:-.3px;line-height:1.3;">' + (o.headline || '') + '</h1>\n' +
      greeting +
      '<p style="margin:0 0 6px;font-family:' + FONT + ';font-size:15px;line-height:1.65;color:' + C.ink2 + ';">' + (o.body || '') + '</p>\n' +
      detailRows +
      cta +
      footerNote +
      '<p style="margin:28px 0 0;font-family:' + FONT + ';font-size:14px;color:' + C.ink2 + ';line-height:1.6;">Warm regards,<br><strong>The UpNow Team</strong></p>\n' +
      '</td></tr>\n' +

      /* FOOTER */
      '<tr><td style="background:' + C.panel + ';border-top:1px solid ' + C.line + ';padding:24px 40px 28px;text-align:center;">\n' +
      '<p style="margin:0 0 4px;font-family:' + FONT + ';font-size:15px;font-weight:800;color:' + C.ink + ';letter-spacing:-.2px;">UpNow</p>\n' +
      '<p style="margin:0;font-family:' + FONT + ';font-size:12.5px;color:' + C.mute + ';">support@upnow.ae</p>\n' +
      social + '\n' +
      '<p style="margin:16px 0 0;font-family:' + FONT + ';font-size:11px;color:#a0a8a4;line-height:1.6;">' +
      '&copy; 2026 UpNow &middot; All rights reserved.<br>' +
      'You are receiving this email because you have an account on UpNow.</p>\n' +
      '</td></tr>\n' +

      '</table>\n' +
      '<!--[if mso]></td></tr></table><![endif]-->\n' +
      '</td></tr>\n' +
      '</table>\n' +
      '</body>\n' +
      '</html>';
  }

  /* ─── sample tenancy data ────────────────────────────────────── */
  var T = {
    name:        'Layla',
    email:       'layla.h@gmail.com',
    property:    'Marina Vista Residences',
    unit:        'Unit 2204',
    address:     'Business Bay, Dubai',
    ref:         'UN-2K26-04812',
    annualRent:  'AED 142,000',
    totalValue:  'AED 156,200',
    leaseStart:  '1 Jun 2026',
    leaseEnd:    '31 May 2027',
    cheques:     '4 cheques (quarterly)',
    firstDue:    '1 Jun 2026',
    firstAmt:    'AED 35,500',
    ejari:       'DLD-EJR-2026-04812',
    ejariDate:   '3 Jun 2026',
    agent:       'Omar Al Rashidi',
    viewDate:    'Tuesday, 2 Jun 2026',
    viewTime:    '11:00 AM',
    docDeadline: '7 Jun 2026',
    renewStart:  '1 Jun 2027',
    renewEnd:    '31 May 2028',
    renewRent:   'AED 148,000',
    renewEjari:  'DLD-EJR-2027-04812',
    dl:          'upnow.ae',
  };

  /* ─── 13 events ─────────────────────────────────────────────── */
  var EVENTS = [

    /* ── 1 · Viewing confirmed ──────────────────────────────── */
    {
      group:   'Tenancy Journey',
      name:    'Viewing confirmed',
      step:    'Step 1 · Viewing',
      subject: 'Your viewing is confirmed — ' + T.property + ', ' + T.unit,
      html: buildEmail({
        preheader: 'Your viewing at ' + T.property + ' is set for ' + T.viewDate + ', ' + T.viewTime + '.',
        badge:     'Step 1 · Viewing',
        headline:  'Your viewing is confirmed',
        body:      'Great news! Your viewing at <strong>' + T.property + ', ' + T.unit + '</strong> is confirmed. Please arrive a few minutes early — your agent will meet you at the building entrance.',
        details: [
          { label: 'Property',  value: T.property + ' &mdash; ' + T.unit },
          { label: 'Address',   value: T.address },
          { label: 'Date',      value: T.viewDate },
          { label: 'Time',      value: T.viewTime },
          { label: 'Agent',     value: T.agent },
          { label: 'Reference', value: T.ref },
        ],
        ctaText:    'Add to calendar',
        ctaHref:    '#',
        footerNote: 'Need to reschedule? <a href="#" style="color:' + C.green + ';text-decoration:none;font-weight:600;">Manage your viewing</a> in your UpNow dashboard.',
      }),
      push: {
        title:    'Viewing confirmed — ' + T.property,
        body:     T.viewDate + ' at ' + T.viewTime + ' · ' + T.address,
        deepLink: T.dl + '/s/4812',
      },
      sms: 'UpNow: Your viewing at ' + T.property + ', ' + T.unit + ' is confirmed for ' + T.viewDate + ' at ' + T.viewTime + '. Manage: ' + T.dl + '/s/4812',
    },

    /* ── 2 · Documents required ─────────────────────────────── */
    {
      group:   'Tenancy Journey',
      name:    'Documents required',
      step:    'Step 2 · Documents',
      subject: 'Action needed: upload your rental documents — ' + T.ref,
      html: buildEmail({
        preheader: 'Please upload your Emirates ID, passport and visa before ' + T.docDeadline + ' to keep your application on track.',
        badge:     'Step 2 · Documents',
        headline:  'Your rental documents are needed',
        body:      'To move your application forward, please upload the required documents before <strong>' + T.docDeadline + '</strong>. Your landlord will review them promptly.',
        details: [
          { label: 'Property',     value: T.property + ' &mdash; ' + T.unit },
          { label: 'Reference',    value: T.ref },
          { label: 'Documents',    value: 'Emirates ID &nbsp;&bull;&nbsp; Passport &nbsp;&bull;&nbsp; UAE Visa / Residency' },
          { label: 'Also needed',  value: 'Salary certificate &nbsp;&bull;&nbsp; 3-month bank statement' },
          { label: 'Deadline',     value: T.docDeadline },
        ],
        ctaText:    'Upload documents',
        ctaHref:    '#',
        footerNote: 'Uploaded everything? Your landlord typically reviews within 1 business day.',
      }),
      push: {
        title:    'Documents needed — ' + T.property,
        body:     'Upload your Emirates ID, passport and visa by ' + T.docDeadline,
        deepLink: T.dl + '/s/4812/docs',
      },
      sms: 'UpNow: Documents are needed for your ' + T.property + ' application. Upload by ' + T.docDeadline + ': ' + T.dl + '/s/4812',
    },

    /* ── 3 · Payment plan shared ─────────────────────────────── */
    {
      group:   'Tenancy Journey',
      name:    'Payment plan shared',
      step:    'Step 3 · Payment plan',
      subject: 'Your payment plan is ready — ' + T.ref,
      html: buildEmail({
        preheader: 'Your landlord has shared the payment plan for ' + T.property + '. Annual rent: ' + T.annualRent + '.',
        badge:     'Step 3 · Payment plan',
        headline:  'Your payment plan is ready to review',
        body:      'Your landlord has shared the payment plan for <strong>' + T.property + ', ' + T.unit + '</strong>. Please review the details and confirm your cheques are ready.',
        details: [
          { label: 'Annual rent',       value: T.annualRent },
          { label: 'Total contract',    value: T.totalValue },
          { label: 'Payment schedule',  value: T.cheques },
          { label: 'First payment',     value: T.firstAmt + ' due ' + T.firstDue },
          { label: 'Reference',         value: T.ref },
        ],
        ctaText:    'Review payment plan',
        ctaHref:    '#',
        footerNote: 'Questions about the plan? <a href="#" style="color:' + C.green + ';text-decoration:none;font-weight:600;">Message your landlord</a> directly from your dashboard.',
      }),
      push: {
        title:    'Payment plan ready — ' + T.property,
        body:     T.annualRent + '/yr · ' + T.cheques + ' · first due ' + T.firstDue,
        deepLink: T.dl + '/s/4812',
      },
      sms: 'UpNow: Your payment plan for ' + T.property + ' is ready. ' + T.annualRent + '/yr, ' + T.cheques + ', first payment ' + T.firstAmt + ' due ' + T.firstDue + '. Review: ' + T.dl + '/s/4812',
    },

    /* ── 4 · Contract ready to sign ─────────────────────────── */
    {
      group:   'Tenancy Journey',
      name:    'Contract ready to sign',
      step:    'Step 4 · Sign contract',
      subject: 'Your tenancy contract is ready — please sign — ' + T.ref,
      html: buildEmail({
        preheader: 'Your tenancy contract for ' + T.property + ' is ready. Please sign to proceed.',
        badge:     'Step 4 · Sign contract',
        headline:  'Your contract is ready to sign',
        body:      'Your tenancy contract for <strong>' + T.property + ', ' + T.unit + '</strong> has been prepared. Please review and sign at your earliest convenience to secure your tenancy.',
        details: [
          { label: 'Property',     value: T.property + ' &mdash; ' + T.unit },
          { label: 'Lease period', value: T.leaseStart + ' &ndash; ' + T.leaseEnd },
          { label: 'Annual rent',  value: T.annualRent },
          { label: 'Reference',    value: T.ref },
        ],
        ctaText:    'Sign your contract',
        ctaHref:    '#',
        footerNote: 'You can also <a href="#" style="color:' + C.green + ';text-decoration:none;font-weight:600;">preview the full contract</a> before signing.',
      }),
      push: {
        title:    'Contract ready — please sign',
        body:     T.property + ', ' + T.unit + ' · ' + T.leaseStart + '–' + T.leaseEnd,
        deepLink: T.dl + '/s/4812',
      },
      sms: 'UpNow: Your tenancy contract for ' + T.property + ', ' + T.unit + ' is ready to sign. Review and sign here: ' + T.dl + '/s/4812',
    },

    /* ── 5 · Ejari registered ────────────────────────────────── */
    {
      group:   'Tenancy Journey',
      name:    'Ejari registered',
      step:    'Step 5 · Ejari',
      subject: 'Your Ejari is registered — ' + T.property + ' · ' + T.ref,
      html: buildEmail({
        preheader: 'Your tenancy has been officially registered with the Dubai Land Department (Ejari). Everything is in order.',
        badge:     'Step 5 · Ejari',
        headline:  'Your Ejari has been registered',
        body:      'Your tenancy at <strong>' + T.property + ', ' + T.unit + '</strong> has been officially registered with the Dubai Land Department. Your Ejari certificate is ready to download.',
        details: [
          { label: 'Property',          value: T.property + ' &mdash; ' + T.unit },
          { label: 'Ejari number',      value: T.ejari },
          { label: 'Registration date', value: T.ejariDate },
          { label: 'Valid until',       value: T.leaseEnd },
          { label: 'Reference',         value: T.ref },
        ],
        ctaText:    'Download Ejari certificate',
        ctaHref:    '#',
        footerNote: 'Keep your Ejari certificate in a safe place — it may be required by DEWA and other government services.',
      }),
      push: {
        title:    'Ejari registered — ' + T.unit,
        body:     'DLD registration complete. Ejari no. ' + T.ejari,
        deepLink: T.dl + '/s/4812/docs',
      },
      sms: 'UpNow: Your Ejari for ' + T.property + ' has been registered with DLD. Ejari no. ' + T.ejari + '. Download your certificate: ' + T.dl + '/s/4812',
    },

    /* ── 6 · Utility account needed ─────────────────────────── */
    {
      group:   'Tenancy Journey',
      name:    'Utility account needed',
      step:    'Step 6 · Utility',
      subject: 'Action needed: set up your DEWA account — ' + T.ref,
      html: buildEmail({
        preheader: 'Almost there! Please register your DEWA utility account to activate your tenancy at ' + T.property + '.',
        badge:     'Step 6 · Utility',
        headline:  'Set up your DEWA utility account',
        body:      'You\'re nearly there! The final step before your tenancy is fully active is to register your DEWA (Dubai Electricity and Water Authority) account for <strong>' + T.property + ', ' + T.unit + '</strong>.',
        details: [
          { label: 'Property',    value: T.property + ' &mdash; ' + T.unit },
          { label: 'Reference',   value: T.ref },
          { label: 'What to do',  value: 'Visit dewa.gov.ae, register a new account, and enter your account number in your UpNow dashboard.' },
        ],
        ctaText:    'Add utility account',
        ctaHref:    '#',
        footerNote: 'Not set up your DEWA account yet? Visit <a href="https://dewa.gov.ae" style="color:' + C.green + ';text-decoration:none;font-weight:600;">dewa.gov.ae</a> to get started.',
      }),
      push: {
        title:    'Utility account needed',
        body:     'Set up DEWA for ' + T.unit + ' to activate your tenancy',
        deepLink: T.dl + '/s/4812',
      },
      sms: 'UpNow: Please add your DEWA account number for ' + T.property + ', ' + T.unit + ' to activate your tenancy. Go to: ' + T.dl + '/s/4812',
    },

    /* ── 7 · Move-in inspection ──────────────────────────────── */
    {
      group:   'Tenancy Journey',
      name:    'Move-in inspection',
      step:    'Step 7 · Move-in',
      subject: 'Action needed: sign your move-in inspection report — ' + T.ref,
      html: buildEmail({
        preheader: 'Your landlord has submitted the move-in inspection report for ' + T.property + '. Please review and countersign.',
        badge:     'Step 7 · Move-in',
        headline:  'Sign your move-in inspection',
        body:      'Your landlord has submitted the move-in inspection report for <strong>' + T.property + ', ' + T.unit + '</strong>. Please review the property condition and countersign to confirm.',
        details: [
          { label: 'Property',     value: T.property + ' &mdash; ' + T.unit },
          { label: 'Submitted',    value: T.leaseStart },
          { label: 'What to do',   value: 'Review the condition report, add any observations, and countersign the inspection.' },
          { label: 'Reference',    value: T.ref },
        ],
        ctaText:    'Review &amp; sign inspection',
        ctaHref:    '#',
        footerNote: 'Once you countersign, your tenancy will be fully active. Any discrepancies should be noted before signing.',
      }),
      push: {
        title:    'Inspection report ready to sign',
        body:     T.property + ' ' + T.unit + ' — review property condition and countersign',
        deepLink: T.dl + '/s/4812',
      },
      sms: 'UpNow: The move-in inspection report for ' + T.property + ', ' + T.unit + ' is ready. Please review and countersign: ' + T.dl + '/s/4812',
    },

    /* ── 8 · Tenancy now active ──────────────────────────────── */
    {
      group:   'Tenancy Journey',
      name:    'Tenancy now active',
      step:    'Step 8 · Active',
      subject: 'Welcome home! Your tenancy is now active — ' + T.property,
      html: buildEmail({
        preheader: 'Your tenancy at ' + T.property + ', ' + T.unit + ' is now active. Welcome home!',
        badge:     'Active tenancy',
        headline:  'Welcome home, ' + T.name + '!',
        body:      'Your tenancy at <strong>' + T.property + ', ' + T.unit + '</strong> is now fully active. You have access to your complete tenancy dashboard — view your contract, payment schedule, and documents any time.',
        details: [
          { label: 'Property',      value: T.property + ' &mdash; ' + T.unit },
          { label: 'Lease period',  value: T.leaseStart + ' &ndash; ' + T.leaseEnd },
          { label: 'Annual rent',   value: T.annualRent },
          { label: 'Next payment',  value: T.firstAmt + ' due 1 Sep 2026' },
          { label: 'Reference',     value: T.ref },
        ],
        ctaText:    'View your tenancy dashboard',
        ctaHref:    '#',
        footerNote: 'Need anything? Your agent <strong>' + T.agent + '</strong> is available through your dashboard messaging.',
      }),
      push: {
        title:    'Tenancy active — welcome home!',
        body:     T.property + ' ' + T.unit + ' · ' + T.leaseStart + '–' + T.leaseEnd,
        deepLink: T.dl + '/s/4812',
      },
      sms: 'UpNow: Your tenancy at ' + T.property + ', ' + T.unit + ' is now active. Welcome home! View your dashboard: ' + T.dl + '/s/4812',
    },

    /* ── 9 · Renewal offer ───────────────────────────────────── */
    {
      group:   'Tenancy Journey',
      name:    'Renewal offer',
      step:    'Renewal · Step 1',
      subject: 'Your landlord has offered renewal terms — ' + T.ref,
      html: buildEmail({
        preheader: 'Your landlord has offered to renew your tenancy at ' + T.property + ' for ' + T.renewStart + '–' + T.renewEnd + '. Please review.',
        badge:     'Renewal · Step 1',
        headline:  'Renewal offer for your tenancy',
        body:      'Your landlord has offered to renew your tenancy at <strong>' + T.property + ', ' + T.unit + '</strong>. Please review the proposed terms and let us know if you would like to proceed.',
        details: [
          { label: 'Property',     value: T.property + ' &mdash; ' + T.unit },
          { label: 'New period',   value: T.renewStart + ' &ndash; ' + T.renewEnd },
          { label: 'New rent',     value: T.renewRent + ' per year' },
          { label: 'Change',       value: '+' + T.renewRent.replace('AED ', '') + ' vs ' + T.annualRent + ' (+4.2%)' },
          { label: 'Offer expires', value: '15 May 2027' },
          { label: 'Reference',    value: T.ref },
        ],
        ctaText:    'Review renewal offer',
        ctaHref:    '#',
        footerNote: 'Not happy with the terms? You can propose changes or decline through your dashboard.',
      }),
      push: {
        title:    'Renewal offer — ' + T.property,
        body:     'New period: ' + T.renewStart + '–' + T.renewEnd + ' · ' + T.renewRent + '/yr',
        deepLink: T.dl + '/s/4812',
      },
      sms: 'UpNow: Your landlord has offered renewal terms for ' + T.property + ', ' + T.unit + '. New rent: ' + T.renewRent + '/yr for ' + T.renewStart + '–' + T.renewEnd + '. Review: ' + T.dl + '/s/4812',
    },

    /* ── 10 · Renewal Ejari registered ──────────────────────── */
    {
      group:   'Tenancy Journey',
      name:    'Renewal Ejari registered',
      step:    'Renewal · Step 5',
      subject: 'Your renewed Ejari is registered — ' + T.ref,
      html: buildEmail({
        preheader: 'Your renewed tenancy at ' + T.property + ' has been registered with the Dubai Land Department.',
        badge:     'Renewal · Ejari',
        headline:  'Your renewed Ejari is registered',
        body:      'Your renewed tenancy at <strong>' + T.property + ', ' + T.unit + '</strong> has been officially registered with the Dubai Land Department for the new lease period.',
        details: [
          { label: 'Property',          value: T.property + ' &mdash; ' + T.unit },
          { label: 'New Ejari number',  value: T.renewEjari },
          { label: 'Registration date', value: '4 Jun 2027' },
          { label: 'New lease period',  value: T.renewStart + ' &ndash; ' + T.renewEnd },
          { label: 'Reference',         value: T.ref },
        ],
        ctaText:    'Download renewed Ejari',
        ctaHref:    '#',
        footerNote: 'Your previous Ejari (' + T.ejari + ') is still available in your document archive.',
      }),
      push: {
        title:    'Renewal Ejari registered',
        body:     'DLD registration updated for ' + T.renewStart + '–' + T.renewEnd,
        deepLink: T.dl + '/s/4812/docs',
      },
      sms: 'UpNow: Your renewed Ejari for ' + T.property + ' is registered. New Ejari no. ' + T.renewEjari + ' (' + T.renewStart + '–' + T.renewEnd + '). Download: ' + T.dl + '/s/4812',
    },

    /* ── 11 · Renewal active ─────────────────────────────────── */
    {
      group:   'Tenancy Journey',
      name:    'Renewal active',
      step:    'Renewal · Active',
      subject: 'Your renewal is live — welcome back to ' + T.property,
      html: buildEmail({
        preheader: 'Your renewed tenancy at ' + T.property + ' is now active for ' + T.renewStart + '–' + T.renewEnd + '.',
        badge:     'Renewal active',
        headline:  'Your renewal is live!',
        body:      'Great news — your renewed tenancy at <strong>' + T.property + ', ' + T.unit + '</strong> is now active. Here\'s a summary of your new lease period.',
        details: [
          { label: 'Property',      value: T.property + ' &mdash; ' + T.unit },
          { label: 'New period',    value: T.renewStart + ' &ndash; ' + T.renewEnd },
          { label: 'Annual rent',   value: T.renewRent },
          { label: 'Ejari number',  value: T.renewEjari },
          { label: 'Reference',     value: T.ref },
        ],
        ctaText:    'View your renewed tenancy',
        ctaHref:    '#',
        footerNote: 'Your first cheque for the renewal period is due <strong>1 Jun 2027</strong>. You can view the full payment schedule in your dashboard.',
      }),
      push: {
        title:    'Renewal active — welcome back!',
        body:     T.property + ' · ' + T.renewStart + '–' + T.renewEnd + ' · ' + T.renewRent + '/yr',
        deepLink: T.dl + '/s/4812',
      },
      sms: 'UpNow: Your renewal at ' + T.property + ', ' + T.unit + ' is now active for ' + T.renewStart + '–' + T.renewEnd + '. View dashboard: ' + T.dl + '/s/4812',
    },

    /* ── 12 · Welcome / registration ────────────────────────── */
    {
      group:   'Account & compliance',
      name:    'Welcome / registration',
      step:    'Account setup',
      subject: 'Welcome to UpNow — your account is ready',
      html: buildEmail({
        preheader: 'Your UpNow account is set up and ready. Browse listings, book viewings, and track your tenancy — all in one place.',
        badge:     'Account setup',
        headline:  'Welcome to UpNow, ' + T.name + '!',
        body:      'Your account is ready. UpNow is your single place to find a home, manage your rental application, and track your tenancy from day one to lease end.',
        details: [
          { label: 'Browse listings', value: 'Explore thousands of vetted properties across Dubai.' },
          { label: 'Book a viewing',  value: 'One tap to schedule a viewing with a verified agent.' },
          { label: 'Track your contract', value: 'Real-time status for every step of your tenancy journey.' },
        ],
        ctaText:    'Complete your profile',
        ctaHref:    '#',
        footerNote: 'Questions? Reply to this email or chat with us at <a href="mailto:support@upnow.ae" style="color:' + C.green + ';text-decoration:none;font-weight:600;">support@upnow.ae</a>.',
      }),
      push: {
        title:    'Welcome to UpNow!',
        body:     'Your account is set up. Start browsing properties or complete your profile.',
        deepLink: T.dl + '/dashboard',
      },
      sms: 'UpNow: Welcome! Your account is ready. Browse properties and book viewings at ' + T.dl,
    },

    /* ── 13 · Document expiry ────────────────────────────────── */
    {
      group:   'Account & compliance',
      name:    'Document expiry',
      step:    'Compliance',
      subject: 'Action needed: a document on your account needs updating',
      html: buildEmail({
        preheader: 'Your Emirates ID is due to expire. Please upload a renewed copy to stay compliant with your tenancy.',
        badge:     'Compliance',
        headline:  'A document needs updating',
        body:      'Your <strong>Emirates ID</strong> on file is due to expire and must be renewed to keep your tenancy documents current. Please upload a fresh copy at your earliest convenience.',
        details: [
          { label: 'Document',    value: 'Emirates ID' },
          { label: 'Status',      value: 'Expiring soon' },
          { label: 'Expiry date', value: '30 Jun 2026' },
          { label: 'Action',      value: 'Upload a renewed Emirates ID before the expiry date.' },
        ],
        ctaText:    'Upload updated document',
        ctaHref:    '#',
        footerNote: 'Your tenancy remains active while you update your documents. Contact <a href="mailto:support@upnow.ae" style="color:' + C.green + ';text-decoration:none;font-weight:600;">support@upnow.ae</a> if you need help.',
      }),
      push: {
        title:    'Emirates ID expiring soon',
        body:     'Please upload your renewed ID to stay compliant with your tenancy.',
        deepLink: T.dl + '/dashboard/profile/documents',
      },
      sms: 'UpNow: Your Emirates ID is due to expire on 30 Jun 2026. Please upload a renewed copy to keep your account compliant: ' + T.dl + '/dashboard',
    },

  ]; /* end EVENTS */

  /* ─── export ─────────────────────────────────────────────────── */
  g.UpnowEmails = {
    EVENTS:     EVENTS,
    buildEmail: buildEmail,
  };

})(window);
