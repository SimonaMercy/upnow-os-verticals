'use client';
/* Split verbatim out of ../page.tsx (lease detail v2) — behaviour unchanged. */



// ────────────────────────────────────────────────────────────────────────────
// Global style block (scoped to .quest-page wrapper)
// ────────────────────────────────────────────────────────────────────────────

export function GlobalStyle() {
  return (
    <style jsx global>{`
      .quest-page {
        --ink: #14201a; --ink-2: #46534c; --ink-3: #54534c;
        --mute: #8a948d; --mute-2: #bdbab2;
        --paper: #ffffff; --surface: #f9f8f6; --mist: #f0ede8; --mist-strong: #e4e9e5;
        --jade: #047246; --jade-deep: #1f5a3f; --jade-soft: #d8efe3; --jade-tint: #eef8f4;
        --saffron: #f59e0b; --saffron-deep: #c2410c; --saffron-soft: #fff7ed; --saffron-edge: #f0d68f;
        --brick: #c8492c; --brick-deep: #9a3520; --brick-soft: #fdede7; --brick-edge: #f3cabb;
        --r-lg: 22px; --r-md: 16px; --r-sm: 12px;
        --sh-card: 0 1px 2px rgba(26,23,20,.04);
        --sh-hero: 0 24px 60px -32px rgba(26,23,20,.2);
        --sh-pop:  0 30px 70px -24px rgba(26,23,20,.34);
        background: var(--surface); color: var(--ink); min-height: 100vh;
        font-family: inherit;
      }
      .quest-page .wrap { max-width: 1240px; margin: 0 auto; padding: 26px 28px 64px; width: 100%; }
      .quest-page button, .quest-page input, .quest-page select, .quest-page textarea { font-family: inherit; color: inherit; }
      .quest-page .eyebrow { font-size: 10px; font-weight: 700; letter-spacing: .13em; text-transform: uppercase; color: var(--mute); }
      .quest-page .note { font-size: 11.5px; color: var(--mute); line-height: 1.5; }

      .quest-page .qhead { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 22px; flex-wrap: wrap; }
      .quest-page .qhead .lhs { display: flex; align-items: center; gap: 14px; min-width: 0; }
      .quest-page .backbtn { width: 42px; height: 42px; border-radius: 12px; border: 1px solid var(--mist-strong); background: #fff; display: grid; place-items: center; color: var(--ink-2); cursor: pointer; flex-shrink: 0; }
      .quest-page .backbtn:hover { border-color: var(--mute-2); color: var(--ink); }
      .quest-page .qhead h1 { margin: 0; font-size: 25px; font-weight: 700; letter-spacing: -.02em; line-height: 1.1; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
      .quest-page .qhead .hsub { font-size: 13px; color: var(--mute); margin-top: 3px; display: flex; align-items: center; gap: 7px; }
      .quest-page .qhead .rhs { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; justify-content: flex-end; }

      .quest-page .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 13px 20px; border-radius: 12px; font-weight: 700; font-size: 14px; border: 1px solid transparent; cursor: pointer; transition: all .15s; line-height: 1; white-space: nowrap; font-family: inherit; text-decoration: none; }
      .quest-page .btn:disabled { opacity: .55; cursor: not-allowed; }
      .quest-page .btn-jade { background: var(--jade); color: #fff; }
      .quest-page .btn-jade:hover:not(:disabled) { background: #268d72; }
      .quest-page .btn-brick { background: var(--brick); color: #fff; }
      .quest-page .btn-brick:hover:not(:disabled) { background: var(--brick-deep); }
      .quest-page .btn-ghost { background: #fff; color: var(--ink-2); border-color: var(--mist-strong); font-weight: 600; }
      .quest-page .btn-ghost:hover:not(:disabled) { border-color: var(--mute-2); color: var(--ink); }
      .quest-page .btn-sm { padding: 10px 15px; font-size: 13px; border-radius: 10px; }
      .quest-page .btn-lg { padding: 15px 24px; font-size: 14.5px; }
      .quest-page .btn-block { width: 100%; }

      .quest-page .pill { display: inline-flex; align-items: center; gap: 6px; padding: 6px 13px; border-radius: 99px; font-size: 11.5px; font-weight: 700; white-space: nowrap; }
      .quest-page .pill.action { background: var(--brick-soft); color: var(--brick); }
      .quest-page .pill.waiting { background: var(--saffron-soft); color: var(--saffron-deep); }
      .quest-page .pill.celebrate { background: var(--jade-soft); color: var(--jade-deep); }
      .quest-page .pill.declined { background: var(--mist); color: var(--ink-2); }
      .quest-page .flag { display: inline-flex; align-items: center; gap: 7px; font-size: 12.5px; font-weight: 700; padding: 9px 15px; border-radius: 99px; border: 1px solid; white-space: nowrap; }
      .quest-page .flag.waiting { background: var(--saffron-soft); color: var(--saffron-deep); border-color: var(--saffron-edge); }

      .quest-page .quest { display: grid; grid-template-columns: minmax(300px,360px) minmax(0,1fr); gap: 26px; align-items: start; }
      @media (max-width: 1040px) { .quest-page .quest { grid-template-columns: 1fr; } }

      .quest-page .qmap { background: var(--surface); border: 1px solid var(--mist-strong); border-radius: var(--r-lg); padding: 22px 14px; position: sticky; top: 84px; }
      @media (max-width: 1040px) { .quest-page .qmap { position: static; } }
      .quest-page .qmap-h { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; padding: 0 8px; }
      .quest-page .qmap-l { display: flex; align-items: center; gap: 8px; font-size: 10px; color: var(--ink-2); text-transform: uppercase; letter-spacing: .12em; font-weight: 700; }
      .quest-page .qmap-l svg { color: var(--brick); }
      .quest-page .qmap-c { font-size: 12px; color: var(--mute); }
      .quest-page .youare { margin-top: 6px; padding: 12px 14px; background: #fff; border: 1px solid var(--mist-strong); border-radius: 14px; display: flex; align-items: center; gap: 11px; }
      .quest-page .youare .yi { width: 30px; height: 30px; border-radius: 99px; display: grid; place-items: center; color: #fff; flex-shrink: 0; }
      .quest-page .youare .yi.here { background: var(--brick); animation: qpulse 2s ease-in-out infinite; }
      .quest-page .youare .yi.done { background: var(--jade-deep); }
      .quest-page .youare .yl { font-size: 9px; color: var(--mute); text-transform: uppercase; letter-spacing: .12em; font-weight: 700; }
      .quest-page .youare .yv { font-size: 13.5px; font-weight: 700; margin-top: 2px; }
      @keyframes qpulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.09); } }

      .quest-page .acard { background: #fff; border: 1px solid var(--mist-strong); border-radius: var(--r-lg); padding: 30px 34px; box-shadow: var(--sh-hero); display: flex; flex-direction: column; }
      @media (max-width: 560px) { .quest-page .acard { padding: 24px 20px; } }
      .quest-page .acard .ahead { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
      .quest-page .acard .ahl { display: flex; align-items: flex-start; gap: 15px; flex: 1; min-width: 0; }
      .quest-page .heroicon { width: 56px; height: 56px; border-radius: 16px; display: grid; place-items: center; color: #fff; flex-shrink: 0; box-shadow: 0 8px 20px -8px rgba(26,23,20,.4); }
      .quest-page .heroicon.action { background: var(--brick); }
      .quest-page .heroicon.waiting { background: var(--saffron-deep); }
      .quest-page .heroicon.celebrate { background: var(--jade-deep); }
      .quest-page .heroicon.declined { background: var(--ink); }
      .quest-page .acard h2 { margin: 5px 0 0; font-size: 27px; line-height: 1.14; letter-spacing: -.02em; font-weight: 700; }
      .quest-page .acard .abody { font-size: 14.5px; color: var(--ink-2); line-height: 1.6; margin: 18px 0 0; }
      .quest-page .acard .action-body { margin-top: 22px; display: grid; gap: 16px; }
      .quest-page .acard .timing { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--mute); margin-top: 22px; padding-top: 16px; border-top: 1px dashed var(--mist-strong); }

      .quest-page .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
      .quest-page .stat { background: var(--surface); border: 1px solid var(--mist-strong); border-radius: 12px; padding: 14px 16px; }
      .quest-page .stat .sl { font-size: 10px; color: var(--mute); text-transform: uppercase; letter-spacing: .08em; font-weight: 700; }
      .quest-page .stat .sv { font-size: 19px; font-weight: 700; letter-spacing: -.02em; margin-top: 6px; font-variant-numeric: tabular-nums; }
      .quest-page .stat .sv.jade { color: var(--jade-deep); }

      .quest-page .qbanner { display: flex; gap: 14px; border: 1px solid; border-radius: var(--r-md); padding: 16px 18px; }
      .quest-page .qbanner .bic { width: 38px; height: 38px; border-radius: 11px; display: grid; place-items: center; flex-shrink: 0; background: #fff; }
      .quest-page .qbanner .bt { font-size: 14.5px; font-weight: 700; margin: 0 0 3px; }
      .quest-page .qbanner .bp { font-size: 13px; margin: 0; line-height: 1.5; }
      .quest-page .qbanner .quote { margin-top: 10px; background: #fff; border-radius: 11px; padding: 10px 13px; font-size: 13px; line-height: 1.45; border: 1px solid; }
      .quest-page .qbanner.action { background: var(--brick-soft); border-color: var(--brick-edge); }
      .quest-page .qbanner.action .bic { color: var(--brick); }
      .quest-page .qbanner.action .bt { color: var(--brick-deep); }
      .quest-page .qbanner.action .bp { color: var(--brick); }
      .quest-page .qbanner.action .quote { border-color: var(--brick-edge); color: var(--ink-2); }
      .quest-page .qbanner.waiting { background: var(--saffron-soft); border-color: var(--saffron-edge); }
      .quest-page .qbanner.waiting .bic { color: var(--saffron-deep); }
      .quest-page .qbanner.waiting .bt { color: var(--saffron-deep); }
      .quest-page .qbanner.waiting .bp { color: var(--saffron-deep); }
      .quest-page .qbanner.waiting .quote { border-color: var(--saffron-edge); color: var(--ink-2); }

      .quest-page .missing { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; background: var(--saffron-soft); border: 1px solid var(--saffron-edge); border-radius: 14px; padding: 11px 16px; margin-bottom: 20px; }
      .quest-page .missing .ml { font-size: 11.5px; font-weight: 700; color: var(--saffron-deep); display: flex; align-items: center; gap: 7px; white-space: nowrap; }
      .quest-page .missing .mchip { font-size: 12.5px; font-weight: 600; color: var(--saffron-deep); background: #fff; border: 1px solid var(--saffron-edge); border-radius: 99px; padding: 6px 13px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
      .quest-page .missing .mchip:hover { background: var(--saffron-soft); }
      .quest-page .missing.allgood { background: var(--jade-tint); border-color: #cfe9df; }
      .quest-page .missing.allgood .ml { color: var(--jade-deep); }

      .quest-page .donepanel { display: flex; align-items: center; gap: 13px; background: var(--jade-tint); border: 1px solid #cfe9df; border-radius: 14px; padding: 14px 16px; }
      .quest-page .donepanel .dp-ic { width: 36px; height: 36px; border-radius: 99px; background: var(--jade); color: #fff; display: grid; place-items: center; flex-shrink: 0; }
      .quest-page .donepanel .dp-t { font-size: 14px; font-weight: 700; color: var(--jade-deep); }
      .quest-page .donepanel .dp-s { font-size: 12px; color: var(--ink-3); margin-top: 1px; }

      .quest-page .chklist { display: flex; flex-direction: column; gap: 9px; }
      .quest-page .chkrow { display: flex; align-items: center; gap: 12px; font-size: 13.5px; padding: 11px 14px; border: 1px solid var(--mist-strong); border-radius: 12px; background: #fff; }
      .quest-page .chkrow.on { background: var(--jade-tint); border-color: #cfe9df; }
      .quest-page .chkrow .cb { width: 22px; height: 22px; border-radius: 7px; display: grid; place-items: center; flex-shrink: 0; font-weight: 800; border: 1.5px solid var(--mist-strong); background: #fff; color: transparent; cursor: pointer; transition: all .14s; }
      .quest-page .chkrow.on .cb { background: var(--jade); border-color: var(--jade); color: #fff; }
      .quest-page .chkrow .ct { flex: 1; min-width: 0; }
      .quest-page .chkrow.on .ct { font-weight: 600; }
      .quest-page .ca { display: inline-flex; align-items: center; gap: 4px; width: fit-content; font-size: 12px; font-weight: 700; color: var(--jade-deep); background: none; border: 0; cursor: pointer; text-decoration: underline; white-space: nowrap; }

      .quest-page .upbox { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; background: var(--surface); border: 1.5px dashed var(--mist-strong); border-radius: 12px; padding: 14px 16px; }
      .quest-page .upbox .uf { display: inline-flex; align-items: center; gap: 9px; font-size: 13px; font-weight: 600; color: var(--ink-2); }
      .quest-page .upbox .uf .ufi { width: 34px; height: 34px; border-radius: 9px; background: #fff; border: 1px solid var(--mist-strong); display: grid; place-items: center; color: var(--jade-deep); }

      .quest-page .details-wrap { margin-top: 32px; }
      /* ── Record page (tabs · stats · rail) — the Leases design ── */
      .quest-page .rbanner { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 12px 16px; border-radius: var(--r-sm); background: #fdf3dc; color: #8a5a00; border: 1px solid #f3e2b8; margin-bottom: 14px; font-size: 13px; }
      .quest-page .rbanner b { color: #5f3e00; }
      .quest-page .rbanner > div { flex: 1; min-width: 220px; }
      .quest-page .rstats { display: grid; grid-template-columns: 1.6fr 1fr 1fr 1fr; background: #fff; border: 1px solid var(--mist-strong); border-radius: var(--r-sm); margin-bottom: 20px; }
      .quest-page .rstats .rs { padding: 16px 20px; min-width: 0; }
      .quest-page .rstats .rs + .rs { border-left: 1px solid var(--mist); }
      .quest-page .rstats .k { font-size: 10.5px; letter-spacing: .07em; text-transform: uppercase; color: var(--mute); font-weight: 700; }
      .quest-page .rstats .v { font-size: 22px; font-weight: 700; letter-spacing: -.02em; margin-top: 6px; font-variant-numeric: tabular-nums; }
      .quest-page .rstats .v small { font-size: 13px; font-weight: 500; color: var(--mute); }
      .quest-page .rstats .s { font-size: 12.5px; color: var(--mute); margin-top: 3px; }
      .quest-page .rstats .bar, .quest-page .rrail .bar { height: 6px; border-radius: 4px; background: var(--mist); overflow: hidden; margin-top: 12px; }
      .quest-page .rstats .bar i, .quest-page .rrail .bar i { display: block; height: 100%; background: var(--jade-deep); border-radius: 4px; }
      .quest-page .rstats .bar i.warn { background: #d4a017; }
      .quest-page .rstats .ends { display: flex; justify-content: space-between; font-size: 12px; color: var(--ink-2); margin-top: 7px; font-variant-numeric: tabular-nums; }
      .quest-page .rstats .ends .m { color: var(--mute); }
      @media (max-width: 1100px) { .quest-page .rstats { grid-template-columns: 1fr 1fr; } .quest-page .rstats .rs.wide { grid-column: 1 / -1; } .quest-page .rstats .rs + .rs { border-left: 0; border-top: 1px solid var(--mist); } }
      .quest-page .details-wrap.rec-grid { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 20px; align-items: start; margin-top: 0; }
      @media (max-width: 1100px) { .quest-page .details-wrap.rec-grid { grid-template-columns: 1fr; } }
      .quest-page .rec-main { min-width: 0; }
      .quest-page .rtabs { display: flex; gap: 4px; border-bottom: 1px solid var(--mist-strong); margin-bottom: 16px; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; }
      .quest-page .rtabs::-webkit-scrollbar { display: none; }
      .quest-page .rtab { position: relative; border: 0; background: none; padding: 10px 12px 12px; font-size: 14px; font-weight: 600; color: var(--mute); display: inline-flex; gap: 7px; align-items: center; white-space: nowrap; cursor: pointer; }
      .quest-page .rtab:hover { color: var(--ink); }
      .quest-page .rtab.on { color: var(--ink); }
      .quest-page .rtab.on::after { content: ""; position: absolute; left: 8px; right: 8px; bottom: -1px; height: 2px; background: var(--jade-deep); border-radius: 2px; }
      .quest-page .rtab .n { font-size: 11px; background: var(--mist); border-radius: 10px; padding: 1px 7px; color: var(--ink-2); font-weight: 600; }
      .quest-page .dbody-inline.tabbed { grid-template-columns: 1fr; }
      .quest-page .rrail { display: grid; gap: 16px; position: sticky; top: 84px; }
      @media (max-width: 1100px) { .quest-page .rrail { position: static; } }
      /* Laptop widths: the rail would leave the ledger ~620px, too narrow for its
         seven columns. Below 1340px it moves under the tabs, its cards side by side. */
      @media (max-width: 1340px) {
        .quest-page .details-wrap.rec-grid { grid-template-columns: 1fr; }
        .quest-page .rrail { position: static; grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: start; }
      }
      @media (max-width: 900px) { .quest-page .rrail { grid-template-columns: 1fr; } }
      .quest-page .rcard { background: #fff; border: 1px solid var(--mist-strong); border-radius: var(--r-sm); padding-bottom: 6px; }
      .quest-page .rcard .rh { padding: 14px 18px 6px; font-size: 10.5px; letter-spacing: .07em; text-transform: uppercase; color: var(--mute); font-weight: 700; }
      .quest-page .rcard .party { display: flex; align-items: center; gap: 12px; padding: 9px 18px; }
      .quest-page .rcard .party .av { width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; font-size: 12px; font-weight: 700; background: var(--jade-soft); color: var(--jade-deep); flex-shrink: 0; }
      .quest-page .rcard .party .av.sq { border-radius: 9px; background: var(--mist); color: var(--ink-2); }
      .quest-page .rcard .party .who { min-width: 0; flex: 1; }
      .quest-page .rcard .party .nm { display: block; font-weight: 600; font-size: 13.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .quest-page .rcard .party small { color: var(--mute); font-size: 12px; }
      .quest-page .rcard .ib { width: 30px; height: 30px; border-radius: 8px; border: 1px solid var(--mist-strong); display: grid; place-items: center; color: var(--ink-2); flex-shrink: 0; }
      .quest-page .rcard .ib:hover { color: var(--ink); border-color: var(--mute-2); }
      .quest-page .rcard .coll { padding: 4px 18px 12px; border-bottom: 1px solid var(--mist); margin-bottom: 4px; }
      .quest-page .rcard .coll .row { display: flex; justify-content: space-between; font-size: 13px; color: var(--ink-2); }
      .quest-page .rcard .coll .row b { color: var(--ink); font-variant-numeric: tabular-nums; }
      .quest-page .rcard .coll .row small { color: var(--mute); font-weight: 500; }
      .quest-page .rcard .coll .bar { margin-top: 8px; }
      .quest-page .rcard .kv { display: flex; justify-content: space-between; gap: 10px; padding: 7px 18px; font-size: 13px; color: var(--ink-2); }
      .quest-page .rcard .kv b { color: var(--ink); font-variant-numeric: tabular-nums; }
      .quest-page .rcard .kv.tot { border-top: 1px solid var(--mist); margin-top: 4px; padding-top: 11px; font-size: 15px; font-weight: 700; color: var(--ink); }
      .quest-page .rcard .fine { padding: 0 18px 6px; font-size: 11px; color: var(--mute); text-align: right; }
      .quest-page .rcard .facts { display: grid; grid-template-columns: 1fr 1fr; padding: 2px 8px 8px; }
      .quest-page .rcard .facts > div { padding: 7px 10px; min-width: 0; }
      .quest-page .rcard .facts > div.full { grid-column: 1 / -1; }
      .quest-page .rcard .facts small { display: block; color: var(--mute); font-size: 11.5px; }
      .quest-page .rcard .facts b, .quest-page .rcard .facts a { font-weight: 600; font-size: 13.5px; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-transform: capitalize; }

      /* ── Record view round 3 ─────────────────────────────────────────────── */
      /* Status pill + menu (replaces the native select everywhere it was used). */
      .quest-page .cstat-btn { display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 9px 0 11px; border: 1px solid transparent; border-radius: 99px;
        font-size: 12px; font-weight: 600; line-height: 1; cursor: pointer; font-family: inherit; white-space: nowrap; transition: box-shadow .15s, filter .15s; }
      .quest-page .cstat-btn:hover:not(:disabled) { box-shadow: 0 0 0 3px rgba(4,114,70,.12); }
      .quest-page .cstat-btn:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(4,114,70,.28); }
      .quest-page .cstat-btn:disabled { opacity: .6; cursor: progress; }
      .quest-page .cstat-btn .cstat-chev { opacity: .65; transition: transform .15s; }
      .quest-page .cstat-btn .cstat-chev.up { transform: rotate(180deg); }
      .cstat-menu { background: #fff; border: 1px solid rgba(26,25,22,.08); border-radius: 12px; padding: 4px; min-width: 188px;
        box-shadow: 0 18px 40px -14px rgba(16,24,20,.28), 0 3px 8px -3px rgba(16,24,20,.10); animation: cstat-pop .14s cubic-bezier(.2,.8,.2,1); font-family: inherit; }
      @keyframes cstat-pop { from { opacity: 0; transform: translateY(-4px) scale(.98); } to { opacity: 1; transform: none; } }
      @media (prefers-reduced-motion: reduce) { .cstat-menu { animation: none; } }
      .cstat-menu .cstat-opt { width: 100%; height: 34px; display: flex; align-items: center; gap: 9px; padding: 0 10px; border: 0; border-radius: 8px; background: none;
        font: inherit; font-size: 13px; color: #14201a; text-align: left; cursor: pointer; }
      .cstat-menu .cstat-opt:hover:not(:disabled), .cstat-menu .cstat-opt:focus-visible { background: #f4f3ee; outline: none; }
      .cstat-menu .cstat-opt.on { font-weight: 600; color: #1f5a3f; background: #eef8f4; }
      .cstat-menu .cstat-opt:disabled { color: #bdbab2; cursor: not-allowed; }
      .cstat-menu .cstat-opt .lb { flex: 1; }
      .cstat-menu .cstat-dot { width: 8px; height: 8px; border-radius: 50%; background: #bdbab2; flex-shrink: 0; }
      .cstat-menu .cstat-dot.cleared, .cstat-menu .cstat-dot.held, .cstat-menu .cstat-dot.with_us { background: #047246; }
      .cstat-menu .cstat-dot.pending, .cstat-menu .cstat-dot.with_head_office, .cstat-menu .cstat-dot.partial_return { background: #f59e0b; }
      .cstat-menu .cstat-dot.bounced, .cstat-menu .cstat-dot.forfeited { background: #c8492c; }

      /* Tabs — the active one is unmistakable: a filled pill in a soft track. */
      /* The ONLY record-tab rules (edit here, don't add another block): clean
         underline tabs — icon · label · count; the active tab is dark with a
         green underline, the rest are quiet until hovered. */
      .quest-page.is-record .rtabs { display: flex; flex-wrap: nowrap; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; gap: 4px; padding: 0; border: 0; border-bottom: 1px solid var(--mist-strong); border-radius: 0; background: none; margin-bottom: 18px; width: 100%; }
      .quest-page.is-record .rtab { position: relative; height: 46px; padding: 0 12px; border-radius: 0; background: none; font-size: 14px; font-weight: 600; color: var(--mute); gap: 8px; transition: color .15s; }
      .quest-page.is-record .rtab svg { opacity: .75; transition: color .15s, opacity .15s; }
      .quest-page.is-record .rtab:hover { color: var(--ink); }
      .quest-page.is-record .rtab:hover::before { content: ""; position: absolute; left: 6px; right: 6px; bottom: -1px; height: 2px; border-radius: 2px; background: var(--mist-strong); }
      .quest-page.is-record .rtab:focus-visible { outline: none; color: var(--ink); box-shadow: inset 0 0 0 2px rgba(4,114,70,.3); border-radius: 8px 8px 0 0; }
      .quest-page.is-record .rtab.on { color: #047246; background: none; font-weight: 700; }
      .quest-page.is-record .rtab.on svg { opacity: 1; color: #047246; }
      .quest-page.is-record .rtab.on::before { display: none; }
      .quest-page.is-record .rtab.on::after { display: block; left: 10px; right: 10px; bottom: -1px; height: 3px; border-radius: 3px 3px 0 0; background: #047246; }
      .quest-page.is-record .rtab .n { min-width: 20px; height: 20px; padding: 0 6px; display: inline-grid; place-items: center; border-radius: 99px; font-size: 11.5px; font-weight: 600; background: #f0eee8; color: var(--ink-3); }
      .quest-page.is-record .rtab.on .n { background: #047246; color: #fff; }
      /* One count chip for every tab's section header (Notes, Emails, WhatsApp — Documents has its own ready/total). */
      /* One type scale across the record tabs: 15px section titles, 13px intro
         copy (it was 11.5px fine print), counts sitting beside the title. */
      .quest-page.is-record .sec .sech .st { font-size: 15px; font-weight: 700; letter-spacing: -.01em; display: inline-flex; align-items: center; flex-wrap: wrap; row-gap: 4px; }
      .quest-page.is-record .sec .secb > p.note { font-size: 13px; line-height: 1.55; color: var(--ink-3); }
      .quest-page.is-record .sec .sech .st .pill { font-size: 12px !important; font-weight: 600; }
      /* Emails / WhatsApp rows reuse the Documents row: date + "N new" on the right. */
      .quest-page.is-record .doclist > .docitem.unread .dn { font-weight: 700; }
      .quest-page.is-record .doclist > .docitem .dacts:has(.em-when) { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
      .quest-page.is-record .doclist .em-when { font-size: 12.5px; color: var(--mute); font-variant-numeric: tabular-nums; white-space: nowrap; }
      .quest-page.is-record .doclist .em-unread { height: 20px; padding: 0 8px; display: inline-flex; align-items: center; border-radius: 99px; background: #047246; color: #fff; font-size: 11.5px; font-weight: 600; }
      /* Breaches header: same button family as the other tabs — Report breach is the
         green primary, Move to legal a quiet outline. Purple stays inside the
         list, where it marks a breach that has actually gone to legal. */
      .quest-page.is-record #sec-breaches .sech .btn { height: 30px; padding: 0 12px; border-radius: 99px; font-size: 12.5px; font-weight: 600; gap: 5px;
        background: #fff !important; color: var(--ink-2) !important; border: 1px solid var(--mist-strong) !important; box-shadow: none; }
      .quest-page.is-record #sec-breaches .sech .btn:hover { border-color: #047246 !important; color: #047246 !important; background: var(--jade-tint) !important; }
      .quest-page.is-record #sec-breaches .sech .btn.btn-ghost { background: #047246 !important; color: #fff !important; border-color: #047246 !important; }
      .quest-page.is-record #sec-breaches .sech .btn.btn-ghost:hover { background: #035c38 !important; color: #fff !important; }
      .quest-page.is-record #sec-breaches .sech .btn svg { width: 13px; height: 13px; }
      /* A tab header's main action (New email, New message): the same filled
         #047246 pill as Report breach. */
      .quest-page.is-record .sec .sech .mini-btn.ok { height: 30px; padding: 0 12px; border-radius: 99px; font-size: 12.5px; font-weight: 600; gap: 5px; border: 1px solid #047246; background: #047246; color: #fff; }
      .quest-page.is-record .sec .sech .mini-btn.ok:hover { background: #035c38; border-color: #035c38; }
      .quest-page .sech .sec-count { margin-left: 8px; display: inline-flex; align-items: center; height: 22px; padding: 0 9px; border-radius: 99px; background: var(--mist); color: var(--ink-2); font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }

      /* Fee table: room for the fee name; receipt numbers in the UI face fit one line. */
      .quest-page.is-record .ptable.ptable-fees tbody tr:not(.segrail):not(.segtot) > td:first-child { font-size: 13px; font-weight: 600; color: var(--ink-2); line-height: 1.35; }
      .quest-page.is-record .rcpt-ref { font-family: inherit !important; font-size: 11.5px !important; font-variant-numeric: tabular-nums; letter-spacing: 0; }

      /* Grand total — the ledger's bottom line, as a strong band. */
      .quest-page.is-record .gtot { margin-top: 18px !important; padding: 14px 18px !important; border-radius: 14px !important; background: #f6f5f1 !important; border: 1px solid var(--mist-strong) !important; }
      .quest-page.is-record .gtot-main { margin: 0 -18px -14px; padding: 16px 18px !important; background: var(--jade-deep); border-radius: 0 0 13px 13px; color: #fff; }
      .quest-page.is-record .gtot > .gtot-main:first-child { margin-top: -14px; border-radius: 13px; }
      .quest-page.is-record .gtot-main > span:first-child { color: rgba(255,255,255,.8) !important; font-size: 13px !important; letter-spacing: .02em !important; text-transform: none !important; font-weight: 600 !important; }
      .quest-page.is-record .gtot-main > span:last-child { color: #fff !important; font-size: 22px !important; font-weight: 700 !important; letter-spacing: -.02em; }
      .quest-page.is-record .gtot:has(> .gtot-main:first-child) { padding: 0 !important; border: 0 !important; background: none !important; }
      .quest-page.is-record .gtot:has(> .gtot-main:first-child) > .gtot-main { margin: 0; }

      /* Side cards — headers with an icon, a tinted total, clearer hierarchy. */
      .quest-page.is-record .rcard { border-radius: 16px; border-color: rgba(26,25,22,.08); box-shadow: 0 1px 2px rgba(16,24,20,.04), 0 8px 20px -16px rgba(16,24,20,.14); overflow: hidden; padding-bottom: 0; }
      .quest-page.is-record .rcard .rh { display: flex; align-items: center; gap: 8px; padding: 14px 18px 8px; font-size: 13px; letter-spacing: 0; text-transform: none; color: var(--ink); font-weight: 700; }
      .quest-page.is-record .rcard .rh .rhi { width: 24px; height: 24px; border-radius: 7px; display: grid; place-items: center; background: var(--jade-tint); color: var(--jade-deep); }
      .quest-page.is-record .rcard .party { padding: 10px 18px; }
      .quest-page.is-record .rcard .party + .party { border-top: 1px solid #f3f1ec; }
      .quest-page.is-record .rcard .party .av { width: 38px; height: 38px; font-size: 13px; }
      .quest-page.is-record .rcard .party .nm { font-size: 14px; }
      .quest-page.is-record .rcard .ib { border-radius: 99px; }
      .quest-page.is-record .rcard .ib:hover { border-color: var(--jade); color: var(--jade-deep); background: var(--jade-tint); }
      .quest-page.is-record .rcard .coll { margin: 2px 14px 8px; padding: 12px 14px; border: 0; border-radius: 12px; background: #f6f5f1; }
      .quest-page.is-record .rcard .coll .row.sub { margin-top: 7px; font-size: 12px; color: var(--mute); }
      .quest-page.is-record .rcard .coll .bar { height: 7px; background: #e6e3db; }
      .quest-page.is-record .rcard .coll .bar i { background: linear-gradient(90deg, #3fb595, #1f5a3f); }
      .quest-page.is-record .rcard .kv { padding: 7px 18px; }
      .quest-page.is-record .rcard .kv.tot { margin: 8px 0 0; padding: 14px 18px; border-top: 0; background: var(--jade-tint); color: var(--jade-deep); font-size: 15px; }
      .quest-page.is-record .rcard .kv.tot b { color: var(--jade-deep); font-size: 17px; }
      .quest-page.is-record .rcard .fine { background: var(--jade-tint); margin: 0; padding: 0 18px 10px; color: #4f7d6c; }
      .quest-page.is-record .rcard .facts { padding: 2px 8px 12px; }

      /* Record rail — Payment summary + Unit cards */
      .quest-page .rcard .rh .ps-pct { margin-left: auto; font-size: 11.5px; font-weight: 700; padding: 3px 9px; border-radius: 99px; background: #fdf3e1; color: #9a6412; font-variant-numeric: tabular-nums; }
      .quest-page .rcard .rh .ps-pct.ok { background: var(--jade-tint); color: var(--jade-deep); }
      .quest-page .rcard .ps-hero { margin: 4px 14px 6px; padding: 14px 16px 13px; border-radius: 14px; background: linear-gradient(135deg, #f3faf7 0%, #f7f6f2 100%); border: 1px solid #e5efe9; }
      .quest-page .rcard .ps-hero > small { display: block; font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--mute); }
      .quest-page .rcard .ps-amt { margin-top: 4px; font-size: 26px; line-height: 1.1; font-weight: 700; letter-spacing: -.02em; color: var(--ink); font-variant-numeric: tabular-nums; }
      .quest-page .rcard .ps-amt .cur { font-size: 13px; font-weight: 600; color: var(--mute); margin-right: 5px; letter-spacing: 0; }
      .quest-page .rcard .ps-of { margin-top: 2px; font-size: 12.5px; color: var(--mute); font-variant-numeric: tabular-nums; }
      .quest-page .rcard .ps-bar { margin-top: 12px; height: 8px; border-radius: 99px; background: #e4e9e5; overflow: hidden; }
      .quest-page .rcard .ps-bar i { display: block; height: 100%; min-width: 8px; border-radius: 99px; background: linear-gradient(90deg, #3fb595, #1f5a3f); }
      .quest-page .rcard .ps-out { display: flex; align-items: center; gap: 6px; margin-top: 10px; font-size: 12.5px; font-weight: 600; color: #9a6412; font-variant-numeric: tabular-nums; }
      .quest-page .rcard .ps-out .dot { width: 7px; height: 7px; border-radius: 50%; background: #f59e0b; }
      .quest-page .rcard .ps-out.ok { color: var(--jade-deep); }
      .quest-page .rcard .ps-list { padding: 8px 18px 6px; }
      .quest-page .rcard .ps-mix { display: flex; gap: 2px; height: 6px; border-radius: 99px; overflow: hidden; margin: 4px 0 8px; }
      .quest-page .rcard .ps-mix i { display: block; flex-basis: 0; min-width: 4px; }
      .quest-page .rcard .ps-row { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 6px 0; font-size: 13px; color: var(--ink-2); }
      .quest-page .rcard .ps-row + .ps-row { border-top: 1px dashed #ece9e2; }
      .quest-page .rcard .ps-row > span { display: inline-flex; align-items: center; gap: 9px; }
      .quest-page .rcard .ps-row b { color: var(--ink); font-weight: 600; font-variant-numeric: tabular-nums; }
      .quest-page .rcard .sw { width: 8px; height: 8px; border-radius: 3px; display: inline-block; }
      .quest-page .rcard .rent { background: #1f5a3f; }
      .quest-page .rcard .other { background: #7c8cc4; }
      .quest-page .rcard .fees { background: #e0a43a; }
      .quest-page .rcard .dep { background: #8fc7b3; }
      .quest-page .rcard .ps-total { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin: 6px 0 0; padding: 14px 18px; background: var(--jade-deep); color: #fff; }
      .quest-page .rcard .ps-total span { display: block; font-size: 13.5px; font-weight: 700; }
      .quest-page .rcard .ps-total small { display: block; margin-top: 2px; font-size: 12px; font-weight: 500; color: rgba(255,255,255,.9); font-variant-numeric: tabular-nums; }
      .quest-page .rcard .ps-total b { font-size: 18px; font-weight: 700; letter-spacing: -.01em; font-variant-numeric: tabular-nums; white-space: nowrap; }
      .quest-page .rcard .ps-inc { padding: 8px 18px 10px; font-size: 11.5px; color: var(--mute); background: #f6f5f1; }
      .quest-page .rcard .uf-head { display: flex; align-items: center; gap: 12px; padding: 6px 18px 12px; }
      .quest-page .rcard .uf-ic { width: 40px; height: 40px; border-radius: 11px; display: grid; place-items: center; flex-shrink: 0; background: var(--jade-tint); color: var(--jade-deep); }
      .quest-page .rcard .uf-who { min-width: 0; flex: 1; }
      .quest-page .rcard .uf-name { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-weight: 700; font-size: 14px; line-height: 1.3; }
      .quest-page .rcard .uf-who small { display: flex; align-items: center; gap: 4px; margin-top: 3px; font-size: 12px; color: var(--mute); }
      .quest-page .rcard .uf-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; padding: 0 14px 12px; }
      .quest-page .rcard .uf-grid > div { min-width: 0; padding: 9px 11px; border-radius: 10px; background: #f6f5f1; }
      .quest-page .rcard .uf-grid small { display: block; font-size: 10.5px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: var(--mute); }
      .quest-page .rcard .uf-grid b, .quest-page .rcard .uf-grid a { display: block; margin-top: 2px; font-size: 14px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .quest-page .rcard .uf-type { padding: 0 18px 14px; }
      .quest-page .rcard .uf-type span { display: inline-block; padding: 3px 10px; border-radius: 99px; border: 1px solid var(--mist-strong); font-size: 11.5px; font-weight: 600; color: var(--ink-2); text-transform: capitalize; }

      /* ── Record view: modern pass ─────────────────────────────────────── */
      /* Header — the status reads as a calm pill with a coloured dot; actions are
         rounded and only the primary one is filled. */
      .quest-page.is-record .qhead h1 { font-size: 26px; letter-spacing: -.025em; }
      /* ── Marketspace look for the lease record (the UpNow marketspace design):
         its palette, Plus Jakarta Sans for the interface and a Roboto Serif title.
         Fonts are self-hosted (globals.css). Record view only. ── */
      .quest-page.is-record {
        --ink: #14201a; --ink-2: #46534c; --ink-3: #5f6b63; --mute: #6f7a73; --mute-2: #b9c2bc;
        --surface: #f4faf7; --mist: #edf1ee; --mist-strong: #e4e9e5;
        --jade: #047246; --jade-deep: #0b3d2a; --jade-soft: #d8efe3; --jade-tint: #eef7f2;
        --sh-card: 0 1px 2px rgba(15,40,28,.06), 0 4px 16px rgba(15,40,28,.06);
        font-family: 'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif;
        background: #f6f8f6; /* the page behind the cards */
      }
      .quest-page.is-record .qhead h1 { font-family: 'Roboto Serif', Georgia, serif; font-weight: 700; font-size: 30px; letter-spacing: -.015em; color: var(--jade-deep); }
      .quest-page.is-record .qhead h1 .pill { font-family: 'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif; }
      /* Grand total: pale mint with dark-green text. (The rail's Total payable keeps its solid jade band so it stands out.) */
      .quest-page.is-record .gtot-main { background: #e6f4ed; color: #0b3d2a; border: 1px solid #cfe8da; }
      .quest-page.is-record .gtot-main > span:first-child { color: #46534c !important; }
      /* Motion + infographics, as in the marketspace portals: the page rises in
         card by card, meters fill from the left, the collected ring draws round,
         and gold marks what needs attention (renewal window, next payment due). */
      @keyframes rec-up { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
      @keyframes rec-grow-x { from { transform: scaleX(0); } }
      @keyframes rec-ring { to { stroke-dashoffset: var(--off); } }
      @keyframes rec-zoom { from { opacity: 0; transform: scale(.7); } }
      @keyframes rec-glow { 50% { box-shadow: 0 0 0 5px rgba(245,194,107,.22); } }
      .quest-page.is-record .qhead, .quest-page.is-record .rbanner, .quest-page.is-record .rglance2, .quest-page.is-record .rtabs { animation: rec-up .5s cubic-bezier(.2,.7,.2,1) both; }
      .quest-page.is-record .rglance2 { animation-delay: .06s; }
      .quest-page.is-record .rglance2 .g2 { animation: rec-up .45s cubic-bezier(.2,.7,.2,1) both; }
      .quest-page.is-record .rglance2 .g2:nth-child(2) { animation-delay: .1s; } .quest-page.is-record .rglance2 .g2:nth-child(3) { animation-delay: .17s; } .quest-page.is-record .rglance2 .g2:nth-child(4) { animation-delay: .24s; }
      .quest-page.is-record .rtabs { animation-delay: .12s; }
      .quest-page.is-record .sections-inline > * { animation: rec-up .45s cubic-bezier(.2,.7,.2,1) both; animation-delay: .18s; }
      .quest-page.is-record .sections-inline > * + * { animation-delay: .26s; }
      .quest-page.is-record .rrail > .rcard { animation: rec-up .5s cubic-bezier(.2,.7,.2,1) both; }
      .quest-page.is-record .rrail > .rcard:nth-child(1) { animation-delay: .14s; } .quest-page.is-record .rrail > .rcard:nth-child(2) { animation-delay: .22s; } .quest-page.is-record .rrail > .rcard:nth-child(n+3) { animation-delay: .3s; }
      .quest-page.is-record .ptable tbody tr { animation: rec-up .35s cubic-bezier(.2,.7,.2,1) both; animation-delay: .3s; }
      .quest-page.is-record .g2-track i, .quest-page.is-record .ps-bar i, .quest-page.is-record .rcard .coll .bar i { transform-origin: left; animation: rec-grow-x 1s .35s cubic-bezier(.3,.8,.2,1) both; }
      .quest-page.is-record .ps-mix { transform-origin: left; animation: rec-grow-x 1s .45s cubic-bezier(.3,.8,.2,1) both; }
      /* Gold: the term inside the renewal window, the next payment due, what is outstanding. */
      .quest-page.is-record .rglance2 .g2-track i.warn { background: linear-gradient(90deg, #f5c26b, #e0a526); }
      .quest-page.is-record .rglance2 .g2-act.next { padding: 4px 10px; margin-top: auto; border-radius: 99px; background: #fdf3dc; color: #5a3a06; box-shadow: inset 0 0 0 1px #f3dca6; }
      .quest-page.is-record .rglance2 .g2-act.next:hover { text-decoration: none; background: #fbe7b8; }
      .quest-page.is-record .rglance2 .g2-term .g2-act.warn { padding: 4px 10px; border-radius: 99px; background: linear-gradient(135deg, #f5c26b, #e0a526); color: #5a3a06; animation: rec-glow 2.4s ease-in-out infinite; }
      .quest-page.is-record .rglance2 .g2-term .g2-act.warn:hover { text-decoration: none; }
      .quest-page.is-record .rcard .ps-out .dot { background: #e0a526; box-shadow: 0 0 0 3px rgba(245,194,107,.3); }
      .quest-page.is-record .rcard .fees { background: #e0a526; }
      .quest-page.is-record .ps-hero.has-ring { display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 12px; align-items: center; }
      .quest-page.is-record .ps-hero.has-ring > .ps-bar, .quest-page.is-record .ps-hero.has-ring > .ps-out { grid-column: 1 / -1; }
      .quest-page.is-record .ps-ring { position: relative; width: 64px; height: 64px; grid-column: 2; grid-row: 1 / span 3; }
      .quest-page.is-record .ps-ring svg { width: 100%; height: 100%; transform: rotate(-90deg); }
      .quest-page.is-record .ps-ring .fg { stroke-dasharray: var(--c); stroke-dashoffset: var(--c); animation: rec-ring 1.4s .35s cubic-bezier(.3,.8,.2,1) forwards; }
      .quest-page.is-record .ps-ring > b { position: absolute; inset: 0; display: grid; place-items: center; font-size: 14px; font-weight: 700; color: var(--jade-deep); font-variant-numeric: tabular-nums; animation: rec-zoom .6s .55s cubic-bezier(.3,1.4,.5,1) both; }
      .quest-page.is-record .ps-hero.has-ring > small, .quest-page.is-record .ps-hero.has-ring > .ps-amt, .quest-page.is-record .ps-hero.has-ring > .ps-of { grid-column: 1; }
      @media (prefers-reduced-motion: reduce) {
        .quest-page.is-record *, .quest-page.is-record *::before, .quest-page.is-record *::after { animation: none !important; }
        .quest-page.is-record .ps-ring .fg { stroke-dashoffset: var(--off); }
      }
      @media print {
        .quest-page.is-record *, .quest-page.is-record *::before, .quest-page.is-record *::after { animation: none !important; }
        .quest-page.is-record .ps-ring .fg { stroke-dashoffset: var(--off) !important; }
      }
      .quest-page.is-record .gtot-main > span:last-child { color: #0b3d2a !important; }
      .quest-page.is-record .qhead h1 .pill { vertical-align: 4px; margin-left: 6px; font-size: 11.5px; font-weight: 600; padding: 3px 10px 3px 9px; background: #f0eee8 !important; color: var(--ink-2) !important; display: inline-flex; align-items: center; gap: 6px; }
      .quest-page.is-record .qhead h1 .pill::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--mute-2, #bdbab2); }
      .quest-page.is-record .qhead h1 .pill.action::before { background: var(--brick); }
      .quest-page.is-record .qhead h1 .pill.waiting::before { background: #f59e0b; }
      .quest-page.is-record .qhead h1 .pill.celebrate::before { background: var(--jade); }
      .quest-page.is-record .qhead .rhs .btn { border-radius: 99px; height: 38px; padding: 0 16px; font-size: 13.5px; }
      .quest-page.is-record .qhead .rhs .btn-ghost { background: #fff; border-color: rgba(26,25,22,.12); }
      .quest-page.is-record .qhead .rhs .btn-ghost:hover { border-color: var(--jade); color: var(--jade-deep); }
      .quest-page.is-record .qhead .rhs .btn-ghost[style*="brick"] { background: transparent; border-color: transparent !important; }
      .quest-page.is-record .qhead .rhs .btn-ghost[style*="brick"]:hover { background: var(--brick-soft); }
      .quest-page.is-record .qhead .rhs .btn-jade { box-shadow: 0 1px 2px rgba(16,24,20,.12), 0 6px 14px -8px rgba(4,114,70,.6); }

      /* No typewriter face — figures in the UI font with even digit widths. */
      .quest-page.is-record .ptable td.ref { font-family: inherit !important; font-variant-numeric: tabular-nums; }

      /* One ledger: both tables share the same columns; the fee table's repeated
         header row goes (its section titles already say what each block is). */
      /* Sized so the widest figure ("AED 65,000" total) fits its cell — an amount
         wider than its column overflows by a different amount per row and the
         right edges stop lining up. Below ~760px the ledger scrolls instead. */
      .quest-page.is-record .ptable { min-width: 760px; }
      /* The ONE set of record-ledger column widths — two older sets further down
         used to override these and were removed. Col 1 holds the fee names. */
      /* Col 1 is only the instalment number (fee rows name their fee under the
         description instead), so it stays a slim gutter; Status is sized to the
         pill + its icon buttons, and the space goes to the description. */
      .quest-page.is-record .ptable col:nth-child(1) { width: 44px !important; }
      .quest-page.is-record .ptable col:nth-child(2) { width: 28% !important; }
      .quest-page.is-record .ptable col:nth-child(3) { width: 14% !important; }
      .quest-page.is-record .ptable col:nth-child(4) { width: 13% !important; }
      .quest-page.is-record .ptable col:nth-child(5) { width: 9% !important; }
      .quest-page.is-record .ptable col:nth-child(6) { width: 12% !important; }
      .quest-page.is-record .ptable col:nth-child(7) { width: auto !important; }  /* takes the remainder (~18%) — fixed % here plus the 44px gutter summed past 100% and pushed the row actions off the card */
      .quest-page.is-record .ptable.ptable-fees thead { display: none; }
      .quest-page.is-record .ptable.ptable-fees td.feecol > span { display: none; }
      .quest-page.is-record .ptable.ptable-fees .fee-kind { display: block !important; }

      /* Money aligns right — the way a ledger is read. */
      .quest-page.is-record .ptable th:nth-child(3),
      .quest-page.is-record .ptable tbody tr:not(.segrail):not(.segtot) > td:nth-child(3),
      .quest-page.is-record .ptable tr.segtot > td.amt { text-align: right; padding-right: 16px !important; padding-left: 8px !important; }
      .quest-page.is-record .ptable tbody tr:not(.segrail):not(.segtot) > td:nth-child(3) .note { text-align: right; }

      /* Receipt number: quiet grey text under the description, no box. */
      .quest-page.is-record .rcpt-ref { background: none !important; border: 0 !important; padding: 0 !important; margin-top: 3px !important;
        color: var(--mute) !important; font-size: 11.5px !important; letter-spacing: -.005em; }
      .quest-page.is-record .rcpt-ref.void { color: var(--brick) !important; }

      /* Headline strip — one compact card, each figure with its next action. */
      .quest-page .rglance2 { display: grid; grid-template-columns: 1.3fr 1fr 1.15fr 1fr; background: #fff; border: 1px solid rgba(26,25,22,.08); border-radius: 16px; margin-bottom: 18px;
        box-shadow: 0 1px 2px rgba(16,24,20,.04), 0 8px 20px -16px rgba(16,24,20,.14); overflow: hidden; }
      .quest-page .rglance2 .g2 { padding: 14px 18px 13px; min-width: 0; display: flex; flex-direction: column; }
      .quest-page .rglance2 .g2 + .g2 { border-left: 1px solid #f0eee8; }
      .quest-page .rglance2 .g2-alert { background: linear-gradient(180deg, #fff6f3, #fff); }
      .quest-page .rglance2 .g2-k { display: flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600; color: var(--ink-3); }
      .quest-page .rglance2 .g2-k svg { color: var(--jade-deep); }
      .quest-page .rglance2 .g2-tag { margin-left: auto; font-size: 11px; font-weight: 600; padding: 1px 7px; border-radius: 99px; background: var(--mist); color: var(--ink-2); font-variant-numeric: tabular-nums; }
      .quest-page .rglance2 .g2-tag.ok { background: var(--jade-soft); color: var(--jade-deep); }
      .quest-page .rglance2 .g2-tag.warn { background: #fdf3dc; color: #8a5a00; }
      .quest-page .rglance2 .g2-v { margin-top: 8px; font-size: 22px; line-height: 1.1; font-weight: 700; letter-spacing: -.02em; color: var(--ink); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .quest-page .rglance2 .g2-v small { font-size: 12.5px; font-weight: 500; letter-spacing: 0; color: var(--mute); }
      .quest-page .rglance2 .g2-s { margin-top: 6px; font-size: 12px; color: var(--mute); font-variant-numeric: tabular-nums; }
      .quest-page .rglance2 .g2-track { position: relative; height: 6px; border-radius: 99px; background: var(--mist); margin-top: 10px; overflow: hidden; }
      .quest-page .rglance2 .g2-track i { position: absolute; inset: 0 auto 0 0; border-radius: 99px; background: linear-gradient(90deg, #3fb595, #1f5a3f); }
      .quest-page .rglance2 .g2-track i.warn { background: linear-gradient(90deg, #f3cf6a, #d4a017); }
      .quest-page .rglance2 .g2-act { margin-top: auto; padding-top: 10px; align-self: flex-start; display: inline-flex; align-items: center; gap: 3px; border: 0; background: none; font: inherit;
        font-size: 12.5px; font-weight: 600; color: var(--jade-deep); cursor: pointer; text-decoration: none; }
      .quest-page .rglance2 .g2-act:hover { text-decoration: underline; }
      .quest-page .rglance2 .g2-act.warn { color: #8a5a00; }
      .quest-page .rglance2 .g2-act.bad { color: var(--brick); }
      @media (max-width: 1100px) { .quest-page .rglance2 { grid-template-columns: 1fr 1fr; } .quest-page .rglance2 .g2:nth-child(3) { border-left: 0; } .quest-page .rglance2 .g2:nth-child(n+3) { border-top: 1px solid #f0eee8; } }
      @media (max-width: 560px) { .quest-page .rglance2 { grid-template-columns: 1fr; } .quest-page .rglance2 .g2 + .g2 { border-left: 0; border-top: 1px solid #f0eee8; } }

      /* ── Record view: headline cards ─────────────────────────────────────── */
      .quest-page .rglance { display: grid; grid-template-columns: 1.5fr 1fr 1fr 1fr; gap: 12px; margin-bottom: 20px; }
      .quest-page .rg { background: #fff; border: 1px solid rgba(26,25,22,.07); border-radius: 16px; padding: 16px 18px 15px; min-width: 0;
        box-shadow: 0 1px 2px rgba(16,24,20,.04), 0 8px 20px -14px rgba(16,24,20,.14); transition: box-shadow .2s ease, transform .2s ease; }
      .quest-page .rg:hover { box-shadow: 0 1px 2px rgba(16,24,20,.05), 0 14px 28px -16px rgba(16,24,20,.22); transform: translateY(-1px); }
      .quest-page .rg-h { display: flex; align-items: center; gap: 8px; min-width: 0; }
      .quest-page .rg-i { width: 28px; height: 28px; border-radius: 9px; display: grid; place-items: center; background: var(--jade-tint); color: var(--jade-deep); flex-shrink: 0; }
      .quest-page .rg-k { font-size: 13px; font-weight: 600; color: var(--ink-3); white-space: nowrap; }
      .quest-page .rg-tag { margin-left: auto; font-size: 11.5px; font-weight: 600; padding: 2px 8px; border-radius: 99px; background: var(--mist); color: var(--ink-2); font-variant-numeric: tabular-nums; white-space: nowrap; }
      .quest-page .rg-tag.ok { background: var(--jade-soft); color: var(--jade-deep); }
      .quest-page .rg-tag.warn { background: #fdf3dc; color: #8a5a00; }
      .quest-page .rg-v { font-size: 26px; line-height: 1; font-weight: 700; letter-spacing: -.025em; margin-top: 14px; color: var(--ink); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .quest-page .rg-v small { font-size: 13px; font-weight: 500; letter-spacing: 0; color: var(--mute); }
      .quest-page .rg-s { font-size: 12.5px; color: var(--mute); margin-top: 9px; }
      .quest-page .rg-s b { color: var(--ink-2); font-weight: 600; }
      .quest-page .rg-track { position: relative; height: 8px; border-radius: 99px; background: var(--mist); margin-top: 16px; }
      .quest-page .rg-track.slim { height: 6px; margin-top: 12px; }
      .quest-page .rg-track i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 99px; background: linear-gradient(90deg, #3fb595, #1f5a3f); }
      .quest-page .rg-track i.warn { background: linear-gradient(90deg, #f3cf6a, #d4a017); }
      .quest-page .rg-track b { position: absolute; top: 50%; width: 14px; height: 14px; border-radius: 50%; background: #fff; border: 3px solid var(--jade-deep); transform: translate(-50%, -50%); box-shadow: 0 1px 3px rgba(16,24,20,.25); }
      .quest-page .rg-track b.warn { border-color: #d4a017; }
      .quest-page .rg-ends { display: flex; justify-content: space-between; font-size: 12px; color: var(--ink-2); margin-top: 10px; font-variant-numeric: tabular-nums; }
      .quest-page .rg-ends .m { color: var(--mute); }
      @media (max-width: 1100px) { .quest-page .rglance { grid-template-columns: 1fr 1fr; } .quest-page .rg-term { grid-column: 1 / -1; } }
      @media (max-width: 560px) { .quest-page .rglance { grid-template-columns: 1fr; } }
      .quest-page.is-record .rbanner { border-radius: 14px; padding: 12px 16px; }

      /* ── Record view: payments ledger — calm, modern table. Record-only, so
         the full contract page keeps its working look. Overrides beat the
         rows' inline styles with !important on purpose. ─────────────────── */
      .quest-page.is-record .sec { border-radius: 16px; border-color: rgba(26,25,22,.08); box-shadow: 0 1px 2px rgba(16,24,20,.04), 0 8px 20px -16px rgba(16,24,20,.12); }
      .quest-page.is-record .sec .sech { padding: 16px 20px; }
      .quest-page.is-record .sec .secb { padding: 4px 8px 10px; }
      .quest-page.is-record .ptable { font-size: 13.5px; }
      .quest-page.is-record .ptable th { font-size: 12px; text-transform: none; letter-spacing: 0; font-weight: 500; color: var(--mute); padding: 10px 12px; background: transparent; border-bottom: 1px solid var(--mist); }
      .quest-page.is-record .ptable td { padding: 14px 12px; border-bottom: 1px solid #f3f1ec; vertical-align: middle; color: var(--ink-2); }
      .quest-page.is-record .ptable tbody tr:not(.segrail):not(.segtot):not(.replgrp) > td { transition: background .12s; }
      .quest-page.is-record .ptable tbody tr:not(.segrail):not(.segtot):not(.replgrp):hover > td { background: #fbfaf7; }
      .quest-page.is-record .ptable tbody tr:not(.segrail):not(.segtot) > td:first-child { color: var(--mute); font-weight: 600; font-variant-numeric: tabular-nums; }
      .quest-page.is-record .ptable .amt { font-size: 14px; font-weight: 700; color: var(--ink); white-space: nowrap; }
      .quest-page.is-record .ptable .amt .note { font-size: 11.5px !important; font-weight: 500; color: var(--mute); white-space: normal; margin-top: 2px; }
      /* Segment header: a quiet section title, count pill and a ghost Add. */
      .quest-page.is-record .ptable tr.segrail > td { border-left: 0 !important; background: transparent !important; padding: 22px 12px 10px !important; border-bottom: 1px solid var(--mist); }
      .quest-page.is-record .ptable tr.segrail:first-child > td { padding-top: 10px !important; }
      .quest-page.is-record .ptable tr.segrail > td > div > span:first-child { font-size: 15px !important; font-weight: 700 !important; letter-spacing: -.01em; color: var(--ink); }
      .quest-page.is-record .ptable tr.segrail .segcount { font-size: 11.5px !important; font-weight: 600 !important; color: var(--ink-2) !important; background: var(--mist); padding: 2px 9px; border-radius: 99px; }
      .quest-page.is-record .ptable .mini-btn.view { background: #fff; border: 1px solid var(--mist-strong); color: var(--ink-2); border-radius: 99px; padding: 5px 11px; font-size: 12px; font-weight: 600; transition: border-color .15s, color .15s, background .15s; }
      .quest-page.is-record .ptable .mini-btn.view:hover { border-color: var(--jade); color: var(--jade-deep); background: var(--jade-tint); }
      /* Section total: a light summary line, not a shouting band. */
      .quest-page.is-record .ptable tr.segtot > td { background: #faf9f6 !important; border-top: 1px solid var(--mist) !important; border-bottom: 0; padding: 13px 12px !important; }
      .quest-page.is-record .ptable tr.segtot > td:first-child { text-transform: none !important; letter-spacing: 0 !important; font-size: 13px !important; font-weight: 600 !important; color: var(--ink-3) !important; border-radius: 10px 0 0 10px; }
      .quest-page.is-record .ptable tr.segtot > td:last-child { border-radius: 0 10px 10px 0; }
      .quest-page.is-record .ptable tr.segtot .amt { font-size: 15px !important; font-weight: 700 !important; color: var(--ink) !important; }
      .quest-page .segtot-prog { display: flex; align-items: center; gap: 12px; justify-content: flex-end; font-size: 12.5px; color: var(--mute); white-space: nowrap; }
      .quest-page .segtot-bar { position: relative; flex: 0 1 120px; min-width: 60px; height: 6px; border-radius: 99px; background: #e9e6de; overflow: hidden; }
      .quest-page .segtot-bar i { position: absolute; inset: 0 auto 0 0; border-radius: 99px; background: linear-gradient(90deg, #3fb595, #1f5a3f); }
      .quest-page .segtot-txt b { color: var(--ink); font-weight: 600; font-variant-numeric: tabular-nums; }
      .quest-page .segtot-txt b.due { color: #8a5a00; }
      .quest-page .segtot-done { display: inline-flex; align-items: center; gap: 4px; color: var(--jade-deep); font-weight: 600; }
      /* Reference: cheque number, the bank beneath — no dangling separator. */
      .quest-page.is-record .ptable td.ref { font-size: 13px; color: var(--ink); letter-spacing: -.01em; }
      .quest-page.is-record .ptable td.ref .bank { display: block; font-size: 11.5px !important; margin-top: 3px; letter-spacing: .02em; font-family: inherit; }
      .quest-page.is-record .ptable td.ref .bank .dot { display: none; }
      /* Receipt number: a small neutral tag under the description. */
      .quest-page.is-record .rcpt-ref { display: inline-block !important; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: top;
        margin-top: 6px !important; padding: 1px 7px; border-radius: 6px; background: #f6f5f1; border: 1px solid var(--mist);
        font-size: 11px !important; color: var(--ink-3) !important; font-family: ui-monospace, Menlo, monospace; }
      .quest-page.is-record .rcpt-ref.void { color: var(--brick) !important; background: var(--brick-soft); border-color: var(--brick-edge); }
      /* Status: a pill that is visibly a control (chevron), actions beside it. */
      .quest-page.is-record .ptable .cstat { font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 99px; line-height: 1.2; }
      .quest-page.is-record .ptable select.cstat { -webkit-appearance: none; appearance: none; height: 28px; padding: 0 26px 0 11px; border: 1px solid transparent;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b6860' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
        background-repeat: no-repeat; background-position: right 9px center; background-size: 12px; transition: box-shadow .15s; }
      .quest-page.is-record .ptable select.cstat:hover { box-shadow: 0 0 0 3px rgba(4,114,70,.12); }
      .quest-page.is-record .ptable select.cstat:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(4,114,70,.25); }
      /* Keep words whole in the record ledger. The base .ptable cells may break
         anywhere, and fixed column widths left "Cheque" / "Commission" split
         mid-word and receipt numbers cut to "Rece…". Keep the column widths,
         wrap only between words, and let a ledger wider than its card scroll. */
      .quest-page.is-record .sec .secb:has(> .ptable), .quest-page.is-record .sec .secb:has(.ptable) { overflow-x: auto; }
      .quest-page.is-record .ptable td, .quest-page.is-record .ptable th { overflow-wrap: normal; word-break: normal; }
      .quest-page.is-record .ptable td:nth-child(3), .quest-page.is-record .ptable td:nth-child(5),
      .quest-page.is-record .ptable td:nth-child(6), .quest-page.is-record .ptable th { white-space: nowrap; }
      .quest-page.is-record .rcpt-ref { max-width: none; overflow: visible; text-overflow: clip; white-space: normal; overflow-wrap: normal; word-break: keep-all; }

      /* ── Record view: deposit as one aligned row — amount · facts · status & actions ── */
      .quest-page.is-record .dep-body { grid-template-columns: minmax(180px, auto) minmax(0, 1fr) auto !important; align-items: center; gap: 14px 28px !important; }
      .quest-page.is-record .dep-top { display: contents !important; }
      .quest-page.is-record .dep-amt > div:first-child { font-size: 26px !important; font-weight: 700 !important; color: var(--ink) !important; letter-spacing: -.025em !important; line-height: 1.1; font-variant-numeric: tabular-nums; }
      .quest-page.is-record .dep-facts { margin-left: 0 !important; display: flex !important; flex-wrap: wrap; gap: 10px 0 !important; }
      .quest-page.is-record .dep-facts .drow2 { display: flex; flex-direction: column; gap: 3px; padding: 2px 22px; border: 0; border-left: 1px solid var(--mist); margin: 0; }
      .quest-page.is-record .dep-facts .drow2 .k { font-size: 12px; font-weight: 500; color: var(--mute); text-transform: none; letter-spacing: 0; }
      .quest-page.is-record .dep-facts .drow2 .v { font-size: 14px; font-weight: 600; color: var(--ink); white-space: nowrap; font-variant-numeric: tabular-nums; }
      .quest-page.is-record .dep-acts { justify-content: flex-end; flex-wrap: nowrap !important; }
      .quest-page.is-record .dep-note { grid-column: 1 / -1; margin: 0; }
      @media (max-width: 900px) {
        .quest-page.is-record .dep-body { grid-template-columns: 1fr !important; }
        .quest-page.is-record .dep-facts .drow2:first-child { border-left: 0; padding-left: 0; }
        .quest-page.is-record .dep-acts { justify-content: flex-start; flex-wrap: wrap !important; }
      }
      /* Same status pill + ghost buttons as the ledger. */
      .quest-page.is-record .dep-acts .cstat { font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 99px; line-height: 1.2; }
      .quest-page.is-record .dep-acts select.cstat { -webkit-appearance: none; appearance: none; height: 30px; padding: 0 26px 0 12px; border: 1px solid transparent; cursor: pointer;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b6860' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
        background-repeat: no-repeat; background-position: right 9px center; background-size: 12px; }
      .quest-page.is-record .dep-acts .mini-btn.view, .quest-page.is-record .ptable .mini-btn.view { height: 30px; padding: 0 12px; }
      .quest-page.is-record .dep-acts .mini-btn.view { background: #fff; border: 1px solid var(--mist-strong); color: var(--ink-2); border-radius: 99px; font-size: 12px; font-weight: 600; }
      .quest-page.is-record .dep-acts .mini-btn.view:hover { border-color: var(--jade); color: var(--jade-deep); background: var(--jade-tint); }

      /* ── Record view: ledger rows on one line — status, Edit and receipt side by side.
         Column widths stay FIXED (auto layout pushed Status off the card at 1280);
         Status gets a little more of them, and the row's Edit becomes a compact
         pencil button (its title still says what it edits). ── */
      .quest-page.is-record .ptable td { padding-top: 12px; padding-bottom: 12px; }
      .quest-page.is-record .ptable td:last-child > div { gap: 6px !important; }
      /* Status cell: the status and its buttons on one line; a follow-up action
         (Record replacement / Link to cheque) on its own line as a quiet link —
         it used to sit beside them and run off the card. */
      .quest-page.is-record .ptable td:last-child > div { flex-wrap: wrap !important; align-items: center; column-gap: 4px !important; row-gap: 6px !important; max-width: 100%; }
      .quest-page.is-record .ptable tbody tr:not(.segrail):not(.segtot) > td:last-child { padding-left: 8px; padding-right: 8px; }
      /* The pill hugs its label + chevron — the old 22px right padding was room
         for a native <select> arrow that no longer exists. */
      .quest-page.is-record .ptable td:last-child button.cstat-btn { padding: 0 8px 0 11px; gap: 4px; }
      /* Status hugs the right edge — the same edge as each section's "+ Add" —
         so no dead gap is left between the actions and the card. */
      .quest-page.is-record .ptable th:last-child { text-align: right; padding-right: 8px; }
      .quest-page.is-record .ptable tbody tr:not(.segrail):not(.segtot) > td:last-child > div { justify-content: flex-end; }
      /* Row actions (Edit, receipt download) are one family: the same 28px round
         icon button, side by side. Edit's label stays in its title/tooltip. */
      .quest-page.is-record .ptable td:last-child button.mini-btn.view[title^="Edit"],
      .quest-page.is-record .ptable td:last-child a.mini-btn.view[href*="pid="] {
        display: flex !important; justify-content: center; place-items: center; width: 28px; height: 28px; padding: 0 !important; gap: 0;
        border: 1px solid var(--mist-strong); background: #fff; border-radius: 99px; color: var(--ink-2); font-size: 0; }
      .quest-page.is-record .ptable td:last-child button.mini-btn.view[title^="Edit"]:hover,
      .quest-page.is-record .ptable td:last-child a.mini-btn.view[href*="pid="]:hover { border-color: var(--jade); color: var(--jade-deep); background: var(--jade-tint); }
      .quest-page.is-record .ptable .mini-btn.view.row-act { justify-content: flex-start; height: 24px; padding: 0 4px; border: 0; background: none; border-radius: 6px;
        color: var(--jade-deep); font-size: 12px; font-weight: 600; gap: 4px; white-space: nowrap; }
      .quest-page.is-record .ptable .mini-btn.view.row-act:hover { background: var(--jade-tint); color: var(--jade-deep); }
      /* One icon size everywhere in the ledger, never squashed. */
      .quest-page.is-record .ptable .mini-btn svg { flex-shrink: 0; width: 13px; height: 13px; }
      /* Cheque custody ("With us", "Head office") under the method — a small chip,
         not a second status-sized pill. */
      .quest-page.is-record .ptable td:nth-child(5) button.cstat-btn { height: 22px; min-height: 0; font-size: 11px; padding: 0 8px; margin-top: 2px; }
      /* Section total: one right-aligned line — a short bar, then collected · outstanding. */
      .quest-page.is-record .segtot-prog { flex-direction: row; align-items: center; justify-content: flex-end; gap: 12px; padding-right: 4px; }
      .quest-page.is-record .segtot-bar { flex: none; width: 110px; }
      /* A bounced cheque is the row that needs work — tint it so it can't be missed. */
      .quest-page.is-record .ptable tbody tr:has(> td button.cstat.bounced) > td { background: #fdf4f2; }
      .quest-page.is-record .ptable tbody tr:has(> td button.cstat.bounced) > td:first-child { box-shadow: inset 3px 0 0 #e0866f; }
      .quest-page.is-record .segtot-txt { font-size: 12.5px; letter-spacing: .005em; }
      .quest-page.is-record .segtot-txt b { font-weight: 700; }

      .quest-page .section-eyebrow { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
      .quest-page .section-eyebrow .se-t { font-size: 15px; font-weight: 700; letter-spacing: -.01em; }
      .quest-page .section-eyebrow .se-line { flex: 1; height: 1px; background: var(--mist-strong); }
      .quest-page .section-eyebrow .se-link { font-size: 12.5px; font-weight: 600; color: var(--jade-deep); cursor: pointer; display: inline-flex; align-items: center; gap: 5px; background: none; border: 0; }
      .quest-page .detail-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; }
      .quest-page .dcard { background: #fff; border: 1px solid var(--mist-strong); border-radius: var(--r-md); padding: 18px 20px; cursor: pointer; transition: all .15s; text-align: left; font-family: inherit; }
      .quest-page .dcard:hover { border-color: var(--mute-2); box-shadow: var(--sh-card); transform: translateY(-2px); }
      .quest-page .dcard .dch { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
      .quest-page .dcard .dci { width: 34px; height: 34px; border-radius: 10px; background: var(--jade-tint); color: var(--jade-deep); display: grid; place-items: center; }
      .quest-page .dcard .dct { font-size: 13.5px; font-weight: 700; flex: 1; }
      .quest-page .dcard .dca { color: var(--mute-2); }
      .quest-page .dcard .drow { display: flex; justify-content: space-between; padding: 5px 0; font-size: 12.5px; }
      .quest-page .dcard .drow .k { color: var(--mute); }
      .quest-page .dcard .drow .v { font-weight: 600; text-align: right; }
      .quest-page .dcard .dbadge { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 99px; background: var(--saffron-soft); color: var(--saffron-deep); }

      .quest-page .scrim { position: fixed; inset: 0; background: rgba(26,23,20,.4); z-index: 60; opacity: 0; pointer-events: none; transition: opacity .22s; }
      .quest-page .scrim.open { opacity: 1; pointer-events: auto; }
      .quest-page .drawer { position: fixed; top: 0; right: 0; height: 100%; width: 640px; max-width: 94vw; background: var(--surface); z-index: 61; transform: translateX(100%); transition: transform .26s cubic-bezier(.4, 0, .2, 1); display: flex; flex-direction: column; box-shadow: var(--sh-pop); }
      .quest-page .drawer.open { transform: none; }
      .quest-page .drawer .dh { display: flex; align-items: center; justify-content: space-between; padding: 16px 22px; background: #fff; border-bottom: 1px solid var(--mist-strong); flex-shrink: 0; }
      .quest-page .drawer .dh .t { font-size: 16px; font-weight: 800; letter-spacing: -.01em; }
      .quest-page .drawer .dh .x { width: 36px; height: 36px; border-radius: 9px; background: var(--surface); border: 0; display: grid; place-items: center; color: var(--ink-2); cursor: pointer; }
      .quest-page .dtabs { display: flex; gap: 2px; overflow-x: auto; background: #fff; border-bottom: 1px solid var(--mist-strong); padding: 0 14px; flex-shrink: 0; scrollbar-width: none; }
      .quest-page .dtabs::-webkit-scrollbar { display: none; }
      .quest-page .dtab { display: flex; align-items: center; gap: 7px; padding: 13px; font-size: 12.5px; font-weight: 700; color: var(--mute); background: none; border: 0; border-bottom: 2px solid transparent; cursor: pointer; white-space: nowrap; }
      .quest-page .dtab:hover { color: var(--ink-2); }
      .quest-page .dtab.on { color: var(--jade-deep); border-bottom-color: var(--jade); }
      .quest-page .dbody { flex: 1; overflow-y: auto; padding: 18px 22px; }
      .quest-page .chain-link { color: var(--jade-deep); font-weight: 600; text-decoration: none; }
      .quest-page .chain-link:hover { text-decoration: underline; }
      /* Inline contract sections — full-width stacked cards. Anchors
         (span[id]) span the grid with zero height so they don't create
         empty cells. */
      .quest-page .dbody-inline { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
      .quest-page .dbody-inline > .sec { margin-bottom: 0; grid-column: 1 / -1; }
      .quest-page .dbody-inline > span[id] { grid-column: 1 / -1; height: 0; margin: 0; padding: 0; }
      @media (max-width: 980px) { .quest-page .dbody-inline { grid-template-columns: 1fr; } }
      /* Info bar — customer + rental period in one row under the header */
      .quest-page .infobar { display: flex; align-items: center; flex-wrap: wrap; gap: 10px 26px; background: #fff; border: 1px solid var(--mist-strong); border-radius: var(--r-md); padding: 10px 18px; margin-bottom: 16px; }
      .quest-page .infobar .pitem { display: flex; flex-direction: column; gap: 1px; }
      .quest-page .infobar .pk { font-size: 9.5px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; color: var(--mute); }
      .quest-page .infobar .pv { font-size: 13px; font-weight: 600; color: var(--ink); white-space: nowrap; }
      /* divider pushes the rental fields to the right edge of the bar */
      .quest-page .infobar .isep { width: 1px; align-self: stretch; background: var(--mist-strong); margin-left: auto; }
      .quest-page .sec { background: #fff; border: 1px solid var(--mist-strong); border-radius: var(--r-md); overflow: hidden; margin-bottom: 14px; }
      .quest-page .sec .sech { display: flex; align-items: center; gap: 10px; padding: 14px 18px; border-bottom: 1px solid var(--mist); }
      .quest-page .sec .sech .si { color: var(--jade-deep); }
      .quest-page .sec .sech .st { font-size: 14px; font-weight: 700; flex: 1; }
      .quest-page .sec .secb { padding: 14px 18px; }
      .quest-page .subhead { font-size: 10.5px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--jade-deep); margin: 0 0 8px; }
      .quest-page .subhead.mut { color: var(--mute); }
      .quest-page .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      @media (max-width: 520px) { .quest-page .grid2 { grid-template-columns: 1fr; } }
      .quest-page .grid3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
      @media (max-width: 620px) { .quest-page .grid3 { grid-template-columns: 1fr; } }
      /* Propose renewal — the "Current contract" summary: four labelled facts across,
         divided, wrapping to 2×2 on a narrow screen. */
      .quest-page .curcontract { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
      .quest-page .curcontract > div { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
      .quest-page .curcontract > div + div { border-left: 1px solid var(--mist-strong); padding-left: 12px; }
      .quest-page .curcontract b { font-size: 13px; font-weight: 800; color: var(--ink); line-height: 1.35; }
      @media (max-width: 760px) {
        .quest-page .curcontract { grid-template-columns: 1fr 1fr; }
        .quest-page .curcontract > div + div { border-left: 0; padding-left: 0; }
      }
      /* Propose renewal — "Annual Rent − Discount = Contract Value" as one row, with
         the operators between the fields. Stacks (operators hidden) when narrow. */
      .quest-page .rentcalc { display: grid; grid-template-columns: 1fr 14px 1.3fr 14px 1fr; gap: 10px; align-items: start; }
      .quest-page .rentcalc .disc { display: grid; grid-template-columns: 1.25fr 1fr; gap: 8px; }
      .quest-page .rentcalc .op { margin-top: 34px; text-align: center; font-size: 15px; font-weight: 800; color: var(--mute-2); }
      @media (max-width: 760px) {
        .quest-page .rentcalc { grid-template-columns: 1fr; }
        .quest-page .rentcalc .op { display: none; }
      }
      .quest-page .ptable { width: 100%; border-collapse: collapse; font-size: 12.5px; }
      .quest-page .ptable th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: var(--mute); font-weight: 700; padding: 8px 8px; border-bottom: 1px solid var(--mist-strong); }
      .quest-page .ptable td { padding: 10px 8px; border-bottom: 1px solid var(--mist); color: var(--ink-2); overflow-wrap: anywhere; }
      .quest-page .ptable tr:last-child td { border-bottom: 0; }
      .quest-page .ptable .amt { font-weight: 700; color: var(--ink); font-variant-numeric: tabular-nums; }
      .quest-page .ptable tfoot td { border-top: 2px solid #bfe3d5; background: var(--jade-tint); font-weight: 800; }
      .quest-page .ptable tfoot .tot { color: var(--jade-deep); }
      /* Bounce → replacement group. The bounced cheque and every payment recorded
         against it share one warm band with a brick rail down its left edge, so
         the pair reads as a single event rather than as unrelated rent lines
         sitting at their own due dates. */
      .quest-page .ptable tr.replgrp > td { background: var(--brick-soft); border-bottom-color: var(--brick-edge); }
      .quest-page .ptable tr.replgrp > td:first-child { box-shadow: inset 3px 0 0 var(--brick); }
      .quest-page .ptable tr.replkid > td { font-size: 12px; }
      .quest-page .ptable .replarrow { color: var(--brick); font-weight: 800; }
      .quest-page .ptable .repltag { display: inline-block; margin-right: 6px; font-size: 9.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .05em; color: var(--brick-deep); background: #fff; border: 1px solid var(--brick-edge); border-radius: 99px; padding: 1px 7px; vertical-align: 1px; }
      /* Record-payment card — the SAME markup + class names as the lead's
         Record Cheques panel (leads/[id]), so the renewal Cheques step and the
         new-lease cheque recording are one design. Keep the two blocks in step:
         a change here belongs in the lead page's stylesheet too. */
      .quest-page .chqbox { border: 1px solid var(--mist-strong); border-radius: var(--r-md); background: var(--surface); padding: 16px; }
      .quest-page .qinput { width: 100%; font-size: 12.5px; border: 1px solid var(--mist-strong); border-radius: 9px; padding: 8px 10px; background: #fff; color: var(--ink); outline: none; }
      .quest-page .qinput:focus { border-color: var(--jade); }
      .quest-page .qinput:disabled { background: var(--mist); color: var(--ink-3); }
      .quest-page .errline { font-size: 11.5px; color: var(--brick); background: var(--brick-soft); border: 1px solid var(--brick-edge); border-radius: 9px; padding: 7px 10px; margin-bottom: 8px; }
      .quest-page .paygrid { display: grid; gap: 6px; }
      .quest-page .payhead { display: grid; grid-template-columns: minmax(0, 1fr) 92px 104px 116px 124px; gap: 8px; padding: 0 10px 2px; font-size: 9.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .06em; color: var(--mute); }
      .quest-page .payrow { display: grid; grid-template-columns: minmax(0, 1fr) 92px 104px 116px 124px; gap: 8px; align-items: center; padding: 8px 10px; border: 1px solid var(--mist-strong); border-radius: 10px; background: #fff; }
      .quest-page .payrow-info { display: flex; align-items: center; gap: 9px; min-width: 0; }
      /* The cheque that pays a row — its own line under the controls, full width,
         small labelled cells side by side, not one dotted sentence. */
      .quest-page .payrow-cheque { grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 18px; padding-top: 6px; border-top: 1px dashed var(--mist-strong); }
      .quest-page .payrow-cheque .linkbtn { font-size: 11.5px; padding: 0; }
      .quest-page .chqstrip { display: flex; flex-wrap: wrap; gap: 4px 14px; }
      .quest-page .chqcell { display: inline-flex; flex-direction: column; min-width: 0; }
      .quest-page .chqcell .k { font-size: 9px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--mute); line-height: 1.2; }
      .quest-page .chqcell .v { font-size: 12.5px; font-weight: 600; color: var(--ink); font-variant-numeric: tabular-nums; line-height: 1.3; white-space: nowrap; }
      .quest-page .payrow-n { font-size: 10px; font-weight: 800; color: var(--jade-deep); background: var(--jade-soft); border-radius: 6px; padding: 2px 6px; font-variant-numeric: tabular-nums; flex-shrink: 0; }
      .quest-page .payrow-lbl { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
      /* The name and its amount line wrap rather than clip — a cut-off name is unreadable. */
      .quest-page .payrow-desc { font-size: 12.5px; color: var(--ink-2); font-weight: 600; overflow-wrap: anywhere; }
      .quest-page .payrow-sub { font-size: 11px; color: var(--mute); font-variant-numeric: tabular-nums; }
      .quest-page .payrow-ctl { width: 100%; min-width: 0; }
      .quest-page .payrow-rec { display: flex; align-items: center; gap: 6px; min-width: 0; }
      .quest-page .payrow-rec > select { flex: 1 1 auto; min-width: 0; }
      .quest-page .payrow-rec > .btn { flex: 1 1 auto; justify-content: center; }
      .quest-page .payrow-rec > .mini-btn { flex: 0 0 auto; }
      /* The step card's status control is a <select>, so it needs the pill
         palette AND a visible control affordance the read-only .cstat pill
         doesn't carry. Scoped to .chqbox — the record's Payments table sizes its
         own status pills and must not grow to match. */
      .quest-page .chqbox select.cstat { border: 1px solid var(--mist-strong); border-radius: 9px; padding: 7px 8px; font-size: 11.5px; cursor: pointer; }
      @media (max-width: 640px) {
        .quest-page .payhead { display: none; }
        .quest-page .payrow { grid-template-columns: 1fr; }
      }
      .quest-page .linkbtn { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 700; color: var(--jade-deep); background: none; border: 0; cursor: pointer; padding: 0; }
      .quest-page .linkbtn:hover { text-decoration: underline; }
      .quest-page .uprow { display: flex; gap: 11px; background: #fff; border: 1px solid var(--mist-strong); border-radius: 12px; padding: 10px; }
      .quest-page .uprow .upthumb { width: 52px; height: 52px; border-radius: 9px; border: 1px solid var(--mist-strong); overflow: hidden; background: var(--surface); display: grid; place-items: center; cursor: pointer; flex-shrink: 0; color: var(--mute); }
      .quest-page .uprow .upthumb:disabled { cursor: default; }
      .quest-page .uprow .upthumb img { width: 100%; height: 100%; object-fit: cover; }
      .quest-page .uprow .upmeta { flex: 1; min-width: 0; }
      .quest-page .uprow .upmeta .dn { font-size: 12.5px; font-weight: 700; color: var(--ink); }
      .quest-page .uprow .upmeta .ds { font-size: 11px; color: var(--mute); margin-top: 1px; }
      .quest-page .uprow .upctl { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 7px; }
      .quest-page .cstat { font-size: 10.5px; font-weight: 700; padding: 3px 9px; border-radius: 99px; border: 0; }
      .quest-page .cstat.cleared { background: var(--jade-soft); color: var(--jade-deep); }
      .quest-page .cstat.pending { background: var(--saffron-soft); color: var(--saffron-deep); }
      .quest-page .cstat.bounced { background: var(--brick-soft); color: var(--brick); }
      .quest-page .cstat.cancelled { background: var(--mist); color: var(--ink-3); }
      /* deposit settlement (deposit_status) — distinct palette from cheque status */
      .quest-page .cstat.held { background: var(--jade-soft); color: var(--jade-deep); }
      .quest-page .cstat.returned { background: var(--mist); color: var(--ink-3); }
      .quest-page .cstat.partial_return { background: var(--saffron-soft); color: var(--saffron-deep); }
      .quest-page .cstat.forfeited { background: var(--brick-soft); color: var(--brick); }
      .quest-page .doclist { display: flex; flex-direction: column; gap: 5px; }
      .quest-page .docitem { display: flex; align-items: center; gap: 9px; border: 1px solid; border-radius: 9px; padding: 5px 10px; min-height: 32px; }
      .quest-page .docitem > svg { flex-shrink: 0; }
      /* name + status share one line — keeps long checklists short */
      .quest-page .docitem > div:not(.dacts) { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
      .quest-page .docitem .dn { font-size: 12.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .quest-page .docitem .ds { font-size: 10.5px; font-weight: 700; white-space: nowrap; flex-shrink: 0; }
      /* Review rows carry a date box and verdicts. One line when the panel is wide
         enough; when it is not, the controls drop to a second line rather than
         covering the name. The name never shrinks; the status text may truncate
         (full text on hover). */
      .quest-page .docitem.review { flex-wrap: wrap; row-gap: 6px; }
      .quest-page .docitem.review > div:not(.dacts) { flex: 1 1 auto; min-width: 0; }
      .quest-page .docitem.review .dn { flex-shrink: 0; }
      .quest-page .docitem.review .ds { flex-shrink: 1; overflow: hidden; text-overflow: ellipsis; }
      .quest-page .docitem.review .dacts { flex: 0 0 auto; display: flex; gap: 6px; align-items: center; margin-left: auto; }
      .quest-page .docitem.review .dexp { width: 128px; padding: 2px 4px; font-size: 11.5px; }
      .quest-page .docitem.approved { background: var(--jade-tint); border-color: #cfe9df; }
      .quest-page .docitem.approved svg, .quest-page .docitem.approved .ds { color: var(--jade-deep); }
      .quest-page .docitem.pending { background: var(--saffron-soft); border-color: var(--saffron-edge); }
      .quest-page .docitem.pending svg, .quest-page .docitem.pending .ds { color: var(--saffron-deep); }
      .quest-page .docitem.rejected { background: var(--brick-soft); border-color: var(--brick-edge); }
      .quest-page .docitem.rejected svg, .quest-page .docitem.rejected .ds { color: var(--brick); }
      /* Missing slots — identical anatomy to on-file rows, dashed border.
         Class is "docmiss" (NOT "missing") to avoid inheriting the journey
         MissingStrip's padding/margin rules. */
      .quest-page .docitem.docmiss { background: #fff; border-style: dashed; border-color: var(--saffron-edge); }
      .quest-page .doc-count { margin-left: 8px; display: inline-flex; align-items: center; gap: 3px; height: 22px; padding: 0 9px; border-radius: 99px; background: var(--jade-tint); color: var(--jade-deep); font-size: 12px; font-weight: 500; white-space: nowrap; font-variant-numeric: tabular-nums; }
      .quest-page .doc-count b { font-weight: 700; }
      .quest-page .doc-count.todo { margin-left: 6px; background: #fdf3dc; color: #8a5a00; font-weight: 600; }
      .quest-page .docitem.docmiss svg, .quest-page .docitem.docmiss .ds { color: var(--saffron-deep); }
      .quest-page .docitem.docmiss .dn { color: var(--mute); }
      .quest-page .docitem.docmiss.req { border-color: var(--brick-edge); }
      .quest-page .docitem.docmiss.req svg, .quest-page .docitem.docmiss.req .ds { color: var(--brick); }
      .quest-page .docitem .dacts { margin-left: auto; display: flex; align-items: center; gap: 5px; flex-shrink: 0; }
      .quest-page .docitem .mini-btn { padding: 3px 8px; }
      .quest-page .docitem .mini-btn:disabled { opacity: .45; cursor: not-allowed; }

      /* ── Record view: documents as one clean list — icon tile · name over
         status · actions. Dividers instead of a stack of tinted boxes; colour
         only where it means something (missing-required red, review amber). ── */
      .quest-page.is-record .doc-cap { text-transform: none !important; letter-spacing: 0 !important; font-size: 12.5px !important; font-weight: 600 !important; color: var(--mute) !important; margin: 4px 2px 8px !important; }
      .quest-page.is-record .doclist { display: block; border: 1px solid var(--mist-strong); border-radius: 14px; overflow: hidden; background: #fff; }
      .quest-page.is-record .doclist > .docitem { border: 0 !important; border-bottom: 1px solid #f3f1ec !important; border-radius: 0 !important; background: #fff !important;
        padding: 11px 14px; min-height: 60px; gap: 12px; margin: 0; transition: background .12s; }
      .quest-page.is-record .doclist > .docitem:last-child { border-bottom: 0 !important; }
      .quest-page.is-record .doclist > .docitem:hover { background: #fbfaf7 !important; }
      .quest-page.is-record .doclist > .docitem > svg:first-child { box-sizing: content-box; width: 16px; height: 16px; padding: 9px; border-radius: 10px; background: var(--jade-tint); color: var(--jade-deep) !important; }
      .quest-page.is-record .doclist > .docitem > div:not(.dacts) { flex-direction: column; align-items: flex-start !important; gap: 2px !important; flex: 1 1 auto; }
      .quest-page.is-record .doclist > .docitem .dn { font-size: 14px; font-weight: 600; color: var(--ink) !important; }
      .quest-page.is-record .doclist > .docitem .ds { font-size: 12.5px; font-weight: 500; color: var(--mute) !important; white-space: normal; }
      .quest-page.is-record .doclist > .docitem.pending > svg:first-child { background: var(--saffron-soft); color: var(--saffron-deep) !important; }
      .quest-page.is-record .doclist > .docitem.pending .ds { color: var(--saffron-deep) !important; }
      .quest-page.is-record .doclist > .docitem.rejected > svg:first-child { background: var(--brick-soft); color: var(--brick) !important; }
      .quest-page.is-record .doclist > .docitem.rejected .ds { color: var(--brick) !important; }
      .quest-page.is-record .doclist > .docitem.docmiss > svg:first-child { background: #fff; color: var(--mute-2, #bdbab2) !important; outline: 1.5px dashed #dcd9cf; outline-offset: -1.5px; }
      .quest-page.is-record .doclist > .docitem.docmiss .dn { color: var(--ink-2) !important; font-weight: 500; }
      .quest-page.is-record .doclist > .docitem.docmiss.req > svg:first-child { color: var(--brick) !important; outline-color: var(--brick-edge); }
      .quest-page.is-record .doclist > .docitem.docmiss.req .ds { color: var(--brick) !important; font-weight: 600; }
      .quest-page.is-record .doclist > .docitem .dacts { gap: 6px; }
      .quest-page.is-record .doclist .mini-btn, .quest-page.is-record .doc-hacts .mini-btn {
        height: 30px; padding: 0 12px; border-radius: 99px; font-size: 12px; font-weight: 600; background: #fff; border: 1px solid var(--mist-strong); color: var(--ink-2); transition: border-color .15s, color .15s, background .15s; }
      .quest-page.is-record .doclist .mini-btn:hover, .quest-page.is-record .doc-hacts .mini-btn:hover { border-color: var(--jade); color: var(--jade-deep); background: var(--jade-tint); }
      .quest-page.is-record .doclist .mini-btn.ok { border-color: #bfe3d5; color: var(--jade-deep); }
      .quest-page.is-record .doc-hacts .mini-btn.ok { background: var(--jade); border-color: var(--jade); color: #fff; }
      .quest-page.is-record .doc-hacts .mini-btn.ok:hover { background: #268d72; color: #fff; }
      .quest-page.is-record .doc-foot { margin-top: 10px !important; padding-left: 2px; }
      .quest-page.is-record .doc-foot .chain-link { font-size: 12.5px; font-weight: 600; color: var(--jade-deep); text-decoration: none; }
      .quest-page.is-record .doc-foot .chain-link:hover { text-decoration: underline; }
      @media (max-width: 640px) { .quest-page.is-record .doclist > .docitem { flex-wrap: wrap; } .quest-page.is-record .doclist > .docitem .dacts { width: 100%; justify-content: flex-end; } }
      /* Inline expiry capture on an undated KYC copy. The date field + Approve don't fit
         beside the status text in a narrow panel, so this row alone is allowed to wrap its
         action strip onto a second line rather than overflow the card. */
      .quest-page .docitem.needsexp { flex-wrap: wrap; row-gap: 6px; }
      .quest-page .docitem.needsexp .dacts { margin-left: auto; }
      .quest-page .docitem .dexp { font-size: 11px; font-weight: 700; padding: 2px 6px; border-radius: 7px; border: 1px solid var(--saffron-edge); background: #fff; color: var(--ink); font-family: inherit; }
      .quest-page .docitem .dexp:focus { outline: 2px solid var(--saffron-deep); outline-offset: 1px; }
      .quest-page .mini-btn { font-size: 11px; font-weight: 700; padding: 6px 10px; border-radius: 8px; border: 0; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; text-decoration: none; }
      .quest-page .mini-btn.ok { background: var(--jade-soft); color: var(--jade-deep); }
      .quest-page .mini-btn.no { background: var(--brick-soft); color: var(--brick); }
      .quest-page .mini-btn.view { background: #fff; color: var(--jade-deep); border: 1px solid var(--mist-strong); }
      .quest-page .clause { display: flex; gap: 11px; background: var(--surface); border: 1px solid var(--mist-strong); border-radius: 12px; padding: 11px 14px; margin-bottom: 8px; }
      .quest-page .clause .cn { width: 22px; height: 22px; border-radius: 99px; background: var(--jade); color: #fff; font-size: 11px; font-weight: 800; display: grid; place-items: center; flex-shrink: 0; }
      .quest-page .clause .ct { flex: 1; font-size: 13px; color: var(--ink-2); line-height: 1.45; }
      .quest-page .drow2 { display: flex; justify-content: space-between; gap: 14px; padding: 9px 0; border-bottom: 1px solid var(--mist); font-size: 13px; }
      .quest-page .drow2:last-child { border-bottom: 0; }
      .quest-page .drow2 .k { color: var(--mute); }
      .quest-page .drow2 .v { font-weight: 600; text-align: right; }

      .quest-page .mscrim { position: fixed; inset: 0; background: rgba(26,23,20,.45); backdrop-filter: blur(3px); z-index: 70; display: flex; align-items: center; justify-content: center; padding: 20px; }
      .quest-page .modal { background: #fff; border-radius: 20px; box-shadow: var(--sh-pop); width: 100%; display: flex; flex-direction: column; max-height: 92vh; overflow: hidden; }
      .quest-page .modal.sm { max-width: 460px; }
      .quest-page .modal.lg { max-width: 680px; }
      /* Propose renewal: a whole term's terms + fee grid + planned schedule in one
         pass, so it gets more room than a regular lg modal. */
      .quest-page .modal.xl { max-width: 980px; }
      .quest-page .modal .mh { display: flex; align-items: center; justify-content: space-between; padding: 18px 22px; border-bottom: 1px solid var(--mist); flex-shrink: 0; }
      .quest-page .modal .mt { font-size: 16px; font-weight: 800; display: flex; align-items: center; gap: 10px; }
      .quest-page .modal .mt .mti { width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; color: #fff; }
      .quest-page .modal .x { width: 34px; height: 34px; border-radius: 9px; border: 0; background: var(--surface); color: var(--ink-2); display: grid; place-items: center; cursor: pointer; }
      .quest-page .modal .mb { padding: 22px; overflow-y: auto; }
      .quest-page .modal .mf { padding: 14px 22px; border-top: 1px solid var(--mist); display: flex; justify-content: flex-end; gap: 10px; flex-shrink: 0; }
      .quest-page .sigpad { border: 1.5px dashed var(--mist-strong); border-radius: 12px; background: var(--surface); position: relative; overflow: hidden; }
      .quest-page .sigpad canvas { display: block; width: 100%; height: 170px; cursor: crosshair; touch-action: none; }
      .quest-page .sigpad .ph { position: absolute; inset: 0; display: grid; place-items: center; color: var(--mute-2); font-size: 13.5px; pointer-events: none; }
      .quest-page .signas { display: flex; align-items: center; gap: 11px; background: var(--jade-tint); border: 1px solid #cfe9df; border-radius: 12px; padding: 12px 15px; margin-bottom: 16px; }
      .quest-page .signas .sa-ic { color: var(--jade-deep); }
      .quest-page .signas .sa-l { font-size: 11px; color: var(--mute); }
      .quest-page .signas .sa-n { font-size: 14px; font-weight: 700; }
      .quest-page .field { margin-bottom: 13px; }
      .quest-page .field label { display: block; font-size: 11.5px; font-weight: 700; color: var(--ink-3); margin-bottom: 5px; }
      .quest-page .input { width: 100%; font-size: 13.5px; padding: 11px 13px; border: 1px solid var(--mist-strong); border-radius: 10px; background: #fff; }
      .quest-page .input:focus { outline: none; border-color: var(--jade); }
      .quest-page textarea.input { resize: vertical; min-height: 70px; }
      .quest-page .infopanel { background: var(--surface); border: 1px solid var(--mist-strong); border-radius: 14px; padding: 16px 18px; }
    `}</style>
  );
}
