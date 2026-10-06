/* Customer Service: guided 10-question chat with keyword FAQ + escalation to the owner's phone */
(function () {
  'use strict';
  const PHONE = AV.OWNER_PHONE; // 455982359
  const TEL = `<a class="tel" href="tel:${PHONE}">${PHONE}</a>`;
  const CALL_MSG = `This one needs a person. Please call the owner directly on ${TEL}. They'll be able to help you properly.`;
  const $ = s => document.querySelector(s);

  /* Open-ended or complex issues always go to the owner */
  const COMPLEX = [
    /\bhow (does|do|did) (this|it|that|the (site|website|whole thing|business|process|vault thing)|everything|you(r)? (guys|business)?) (all )?work/i,
    /\b(how|what) (is|does) (this|auction vault) (place|site|business)?\s*(do|about)?\b\??$/i,
    /\bproblem|\bissue with|\bcomplain|\bcomplaint|\bbroken|\bdamaged?|\bfaulty|\bdefective|\bnot (arrived|received|working|delivered|showing)|\bnever (arrived|received|came|got)|\bwrong (item|order|amount|size)|\bmissing|\bscam|\bfraud|\bstolen|\bdispute|\bcharged (twice|wrong|incorrectly)|\bdouble charged|\breport(ing)?\b|\bunhappy|\bdisappointed|\bangry|\blawyer|\blegal|\bbug\b|\berror\b|\bdoesn'?t work|\bcan'?t (log|sign|bid|offer|access)|\bhacked|\bharass/i
  ];

  const FAQ = [
    { id: 'pickup', kw: /ship|deliver|postage|post\b|courier|tracking|track my|send it|dispatch|arrive|pick ?up|collect|meet/i,
      a: 'Pickup: We don\'t post or ship anything. When you make an offer you choose a meet-up point (Languages Building, MPH - Bathrooms or Art Building) and a time (lunch or recess). You collect the item there and pay the amount you offered in cash — no cards.' },
    { id: 'payment', kw: /pay|payment|card|visa|mastercard|amex|paypal|afterpay|bank|transfer|cash|invoice|checkout|check out/i,
      a: 'We don\'t take cards or online payments. Make an offer on the item; the highest offer wins and you pay in cash at the meet-up (Languages Building, MPH - Bathrooms or Art Building, at lunch or recess).' },
    { id: 'bidding', kw: /bid|bidding|outbid|offer|highest bidder|win(ning)? an? auction|reserve|auction (end|work|close)|how (do i|to) (bid|win|buy)/i,
      a: 'How offers work: Open an item on the Auction page, enter an offer at or above the minimum shown and press "Make offer". The highest offer when the timer reaches zero wins. Then you pay the amount you offered in cash at the meet-up — no cards.' },
    { id: 'bin', kw: /buy it now|full price|instant buy|buy (straight|right) away/i,
      a: 'Offer full price: Every listing shows a full price. Click "Offer full price", confirm, then pick a meet-up point and time. A full-price offer wins the item straight away and the listing closes. You pay that amount in cash at the meet-up — no cards. Discounted items show the original price struck through next to the sale price.' },
    { id: 'returns', kw: /return|refund|exchange|money back|send (it )?back|change my mind/i,
      a: 'Returns: Auction items and mystery vaults are sold as-is, so change-of-mind returns aren\'t offered. If an item is significantly not as described, contact us within 7 days of receiving it and we\'ll make it right.' },
    { id: 'account', kw: /account|log ?in|sign ?(in|up)|register|password|username|profile|my details/i,
      a: 'Account: You don\'t need an account to browse or make an offer on this site. Offers are saved online, so the seller sees them straight away. If you need to change your meet-up details, call the owner and quote your reference number (e.g. PU-XXXXX or VO-XXXXX).' },
    { id: 'hours', kw: /opening hours|\bhours\b|what time|when (are|do) you (open|close)|are you open|open (on|today|tomorrow|now|weekends?|sundays?|saturdays?)|closing time|business hours|public holiday/i,
      a: 'Opening hours: Mon–Fri 9am–5pm, Sat 10am–2pm, closed Sundays and public holidays. Online auctions run 24/7.' },
    { id: 'contact', kw: /contact|phone|\bcall\b|email|speak to|talk to|human|real person|owner|phone number/i,
      a: `Contact: You can reach the owner by phone on ${TEL} during opening hours.` },
    { id: 'vault', kw: /vault|storage|unit|mystery|tier|what'?s inside|contents/i,
      a: 'Storage Units: Choose a tier on the Storage Units page and press "Make an offer". The price shown is a guide; the highest offer wins. You pay the amount you offered in cash at the meet-up — no cards. Higher tiers mean a more premium mystery.' },
    { id: 'discount', kw: /discount|sale|deal|coupon|promo|voucher|% ?off|cheap/i,
      a: 'Deals: Discounted items show an orange "% OFF" badge on the Auction page. Tick "Deals only" to see them all. Discounts apply to the full price.' },
    { id: 'fees', kw: /fee|premium|commission|gst|tax|extra charge|hidden cost/i,
      a: 'Fees: There are no buyer\'s premiums, card fees or hidden fees. You pay exactly the amount you offered, in cash at the meet-up. Prices include GST.' },
    { id: 'cancel', kw: /cancel|retract|withdraw (my )?bid|undo/i,
      a: `Cancelling: Offers are binding once made, so please offer carefully. To cancel a meet-up, call the owner on ${TEL} with your reference number.` },
    { id: 'sell', kw: /\bsell\b|selling|consign|list (my|an) item/i,
      a: `Selling: Want to sell through Auction Vault? Please call the owner on ${TEL} to discuss consignment.` }
  ];

  function classify(text) {
    const t = String(text || '').trim();
    if (!t) return { type: 'none' };
    if (COMPLEX.some(r => r.test(t))) return { type: 'escalate' };
    const hits = FAQ.filter(f => f.kw.test(t));
    if (hits.length) return { type: 'faq', hits: hits.slice(0, 2) };
    return { type: 'escalate' };
  }

  const NO_RE = /^(no|nope|nah|nothing|none|n|no thanks|all good|that'?s all|i'?m good|im good)\.?!?$/i;

  /* The 10 questions */
  const Q = [
    { key: 'name', ask: () => "Hi! I'm the Vault Assistant. 👋 What's your name?", required: true },
    { key: 'contact', ask: a => `Nice to meet you, ${a.name}. What's the best email or phone number to reach you? (Type "skip" to skip.)`, skippable: true },
    { key: 'topic', ask: () => 'What is your enquiry about?', options: ['Mystery Storage Vault', 'Auction / Offers', 'An offer I made', 'My account', 'Something else'] },
    { key: 'relates', ask: () => 'Does this relate to an offer you made or an auction listing?', options: ['An offer I made', 'An auction listing', 'Neither, a general question'] },
    { key: 'item', ask: a => /neither/i.test(a.relates) ? 'Is there a particular item or vault tier you\'re interested in? (Type "skip" if not.)' : 'Which item or vault is it about?', skippable: true },
    { key: 'ref', ask: () => 'Do you have a reference number (e.g. PU-XXXXX or VO-XXXXX) or listing name? (Type "skip" if not.)', skippable: true },
    { key: 'question', ask: () => 'Now tell me your question or describe what you need help with.', required: true, resolve: true },
    { key: 'followup', ask: a => a._lastType === 'faq' ? 'Did that answer your question?' : 'How urgent is this for you?',
      options: a => a._lastType === 'faq' ? ['Yes, thanks!', 'No, not really'] : ['Today', 'This week', 'Not urgent'] },
    { key: 'more', ask: () => 'Is there anything else you\'d like to ask? (Type your question, or "no".)', resolve: true, allowNo: true },
    { key: 'rating', ask: () => 'Last one! How would you rate this chat from 1 to 5?', options: ['5 ⭐', '4', '3', '2', '1'] }
  ];

  let step, answers, resolutions, unresolved;

  function bubble(html, cls) {
    const d = document.createElement('div');
    d.className = 'bubble ' + (cls || 'bot'); d.innerHTML = html;
    $('#log').appendChild(d); $('#log').scrollTop = $('#log').scrollHeight; return d;
  }
  function botSay(html, cls, delay) {
    return new Promise(res => {
      const typing = bubble('<span class="muted">typing…</span>', 'bot');
      setTimeout(() => { typing.remove(); bubble(html, cls); res(); }, delay == null ? 450 : delay);
    });
  }
  function setQuick(opts) {
    $('#quick').innerHTML = (opts || []).map(o => `<button type="button">${AV.esc(o)}</button>`).join('');
  }
  function progress() { $('#progress').textContent = step < Q.length ? `Question ${step + 1} of ${Q.length}` : 'Complete'; }

  async function askCurrent() {
    progress();
    if (step >= Q.length) return finish();
    const q = Q[step];
    await botSay(AV.esc(q.ask(answers)));
    const opts = typeof q.options === 'function' ? q.options(answers) : q.options;
    setQuick(opts || (q.skippable ? ['skip'] : q.allowNo ? ['No, that\'s all'] : []));
    $('#chat-in').disabled = false; $('#chat-in').focus();
  }

  async function handle(text) {
    text = String(text || '').trim();
    if (step >= Q.length) return;
    const q = Q[step];
    if (!text) return;
    bubble(AV.esc(text), 'user'); setQuick([]); $('#chat-in').value = '';
    if (q.required && text.length < 1) return askCurrent();
    let val = text;
    if (q.skippable && /^skip$/i.test(text)) val = '—';
    answers[q.key] = val;

    if (q.key === 'followup' && answers._lastType === 'faq' && /^no/i.test(text)) {
      unresolved = true;
      await botSay(`Sorry about that. ${CALL_MSG}`, 'alert');
    }
    if (q.resolve) {
      if (q.allowNo && NO_RE.test(text.replace(/,.*$/, '').trim())) {
        answers[q.key] = '—';
      } else {
        const r = classify(text);
        answers._lastType = r.type;
        if (r.type === 'faq') {
          for (const h of r.hits) await botSay(h.a);
          resolutions.push({ q: text, outcome: 'Answered (' + r.hits.map(h => h.id).join(', ') + ')' });
        } else {
          unresolved = true;
          await botSay(CALL_MSG, 'alert');
          resolutions.push({ q: text, outcome: 'Needs owner, call ' + PHONE });
        }
      }
    }
    step++;
    askCurrent();
  }

  async function finish() {
    $('#chat-in').disabled = true; setQuick(['Start a new chat']); progress();
    const a = answers;
    const rows = [
      ['Name', a.name], ['Contact', a.contact], ['Topic', a.topic], ['Relates to', a.relates],
      ['Item / vault', a.item], ['Reference', a.ref], ['Your question', a.question],
      ['Follow-up', a.followup], ['Other question', a.more], ['Chat rating', a.rating]
    ];
    const res = resolutions.map(r => `• "${AV.esc(r.q)}": ${AV.esc(r.outcome)}`).join('<br>') || '• No questions asked';
    await botSay(`<strong>📋 Summary of your enquiry</strong><br>${rows.map(r => `<strong>${r[0]}:</strong> ${AV.esc(r[1] || '—')}`).join('<br>')}<br><br><strong>Outcome</strong><br>${res}<br><br>` +
      (unresolved
        ? `<strong>Status: Not fully resolved.</strong><br>Please call the owner on ${TEL} and mention the details above. They'll sort it out for you.`
        : `<strong>Status: Resolved ✅</strong><br>Thanks for contacting Auction Vault, ${AV.esc(a.name)}! If anything else comes up, call the owner on ${TEL}.`), 'summary', 700);
    try { const log = AV.read('av_support_log_v1', []); log.push({ at: Date.now(), answers: a, resolutions, unresolved }); AV.write('av_support_log_v1', log.slice(-50)); } catch (e) {}
  }

  function start() {
    step = 0; answers = {}; resolutions = []; unresolved = false;
    $('#log').innerHTML = ''; askCurrent();
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('#chat-form').addEventListener('submit', e => { e.preventDefault(); handle($('#chat-in').value); });
    $('#quick').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.textContent === 'Start a new chat') return start();
      handle(b.textContent);
    });
    $('#restart').addEventListener('click', e => { e.preventDefault(); start(); });
    start();
  });

  window.AVSupport = { classify }; // exposed for testing
})();
