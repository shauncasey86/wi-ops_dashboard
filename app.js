/* Boot error handler and loading guard */
(function(){
  const show = (msg) => {
    try{
      console.error('[BOOT ERROR]', msg);
      const errorText = document.getElementById('boot-error-text');
      const errorPanel = document.getElementById('boot-error');
      if(errorText) errorText.textContent = String(msg || 'Unknown error');
      if(errorPanel) errorPanel.style.display = 'flex';
      const root = document.getElementById('root');
      if(root) root.style.display = 'none';
    }catch(e){
      console.error('[BOOT ERROR HANDLER FAILED]', e);
    }
  };
  window.onerror = function(message, source, lineno, colno, error){
    const details = [
      message || 'Unknown error',
      source ? ('\nSource: '+source) : '',
      (lineno!=null && colno!=null) ? ('\nLine: '+lineno+':'+colno) : '',
      error && error.stack ? ('\n'+error.stack) : ''
    ].join('');
    show(details);
    return false;
  };
  window.addEventListener('unhandledrejection', e => {
    const details = (e && e.reason && e.reason.stack) || (e && e.reason) || e;
    show('Unhandled Promise Rejection:\n' + details);
  });
  setTimeout(()=>{
    const root = document.getElementById('root');
    if(root && /Loading/.test(root.textContent||'')){
      show('Application failed to initialize within 10 seconds.\n\nPossible causes:\n- JavaScript syntax error\n- React/ReactDOM failed to load\n- Network connectivity issues\n- CORS configuration\n\nCheck browser console (F12) for detailed errors.');
    }
  }, 10000);
})();

/* ===== React App (Babel/JSX) ===== */
if (!window.React || !window.ReactDOM) { throw new Error("React/ReactDOM failed to load"); }

const {useMemo,useRef,useState,useLayoutEffect} = React;

/* ===== Dashboard Mode Detection ===== */
const DASHBOARD_MODE = window.DASHBOARD_MODE || 'operations'; // 'operations' or 'delivery'
const isDeliveryDashboard = () => DASHBOARD_MODE === 'delivery';
const isOperationsDashboard = () => DASHBOARD_MODE === 'operations';

/* Formatters */
const FMT_CARD_DAY = new Intl.DateTimeFormat(undefined,{weekday:"short",day:"2-digit",month:"short"});
const FMT_TV_DAY   = FMT_CARD_DAY;
const FMT_WEEK_ROW = new Intl.DateTimeFormat(undefined,{weekday:"short",day:"2-digit",month:"short",year:"numeric"});
const FMT_LONG_DAY = new Intl.DateTimeFormat(undefined,{weekday:"long",day:"2-digit",month:"long",year:"numeric"});
const FMT_WC       = new Intl.DateTimeFormat(undefined,{day:"2-digit",month:"short",year:"numeric"});
const FMT_WEEK_MM  = new Intl.DateTimeFormat(undefined,{day:"2-digit",month:"short"});
const FMT_YEAR     = new Intl.DateTimeFormat(undefined,{year:"numeric"});
const FMT_UPDATED  = new Intl.DateTimeFormat(undefined,{hour:"2-digit",minute:"2-digit"});

const SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSNoJjwbml_e90J-nZrkiygBCMnEB9HWhNl6HFqaK15qzIM4nS-Z-UkuPKGvxgbpfZ1L8ZawU94FYKY/pub?single=true&gid=829525514&output=csv";

const CUSTOMER_BADGES = {
  JC:   { bg:"#E53935", color:"#ffffff" },
  KWL:  { bg:"#1E88E5", color:"#ffffff" },
  OTHER:{ bg:"#E8DFC8", color:"#2B2B2B" }
};

function carrierMetaFromType(raw){
  const t = normalizeText(raw).toUpperCase();
  if(!t) return null;
  if(t==="RD TRANSPORT"){return { iconLabel:"RD", printLabel:"RD", title:"RD Transport" };}
  if(t==="AWS"){return { iconLabel:"AWS", printLabel:"AWS", title:"AWS" };}
  if(t==="AAA"){return { iconLabel:"AAA", printLabel:"AAA", title:"AAA" };}
  if(t==="BENJI"){return { iconLabel:"BENJI", printLabel:"Benji", title:"Benji" };}
  if(t==="COLLECTION"){return { iconLabel:"COLLECTION", printLabel:"Collection" };}
  return null;
}

const customerStyleCache = new Map();
function getCustomerStyle(customerRaw){
  const s = String(customerRaw||"").toUpperCase();
  if (customerStyleCache.has(s)) return customerStyleCache.get(s);
  let style;
  if (s.indexOf("KWL")>-1) style = CUSTOMER_BADGES.KWL;
  else if (s.indexOf("JC")>-1) style = CUSTOMER_BADGES.JC;
  else style = CUSTOMER_BADGES.OTHER;
  customerStyleCache.set(s, style);
  return style;
}

function normalizeText(s){
  if(s==null) return "";
  return String(s).replace(/\uFFFD/g,"").trim();
}

function normalizeCustomerGroup(customerRaw){
  const s = String(customerRaw||"").toUpperCase();
  if (s.indexOf("JC")>-1) return "JC";
  if (s.indexOf("KWL")>-1) return "KWL";
  return "OTHER";
}

async function fetchCsvText(url, signal){
  const bust = Date.now();
  const urlWithBust = url + (url.indexOf('?')>-1 ? '&' : '?') + 'nocache=' + bust;
  const res = await fetch(urlWithBust,{signal,cache:"no-store",redirect:"follow"});
  if(!res.ok) throw new Error("Network error: "+res.status+" "+res.statusText);
  const buf = await res.arrayBuffer();
  let text = "";
  try{ text = new TextDecoder("utf-8").decode(buf); }
  catch(e){ text = String.fromCharCode.apply(null, new Uint8Array(buf)); }
  return text;
}

function parseCSVFallback(csvText){
  const rows=[];let i=0,field="",row=[],inQuotes=false;
  while(i<csvText.length){
    const c=csvText[i];
    if(inQuotes){
      if(c==='"'){
        if(csvText[i+1]==='"'){field+='"';i+=2;continue;}
        inQuotes=false;i++;continue;
      }
      field+=c;i++;continue;
    }else{
      if(c==='"'){inQuotes=true;i++;continue;}
      if(c===','){row.push(field);field="";i++;continue;}
      if(c==="\n"){row.push(field);rows.push(row);row=[];field="";i++;continue;}
      if(c==="\r"){i++;continue;}
      field+=c;i++;
    }
  }
  row.push(field);rows.push(row);return rows;
}

function startOfWeekMonday(d){
  const date=new Date(d);
  const day=date.getDay();
  const diff=(day===0?-6:1)-day;
  const theMon=new Date(date);
  theMon.setDate(date.getDate()+diff);
  theMon.setHours(0,0,0,0);
  return theMon;
}
function endOfWeekMonday(d){
  const mon=startOfWeekMonday(d);
  const sun=new Date(mon);
  sun.setDate(mon.getDate()+6);
  sun.setHours(23,59,59,999);
  return sun;
}
function isSameDay(a,b){return a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();}
function withinWeek(date,weekStart){return date>=startOfWeekMonday(weekStart)&&date<=endOfWeekMonday(weekStart);}
function formatWeekRange(weekStart){
  const s=startOfWeekMonday(weekStart), e=endOfWeekMonday(weekStart);
  return new Intl.DateTimeFormat(undefined,{day:"2-digit",month:"short"}).format(s) + " - " + new Intl.DateTimeFormat(undefined,{day:"2-digit",month:"short",year:"numeric"}).format(e);
}
function parseDateFromCell(v){
  if(!v) return null; v=String(v).trim();
  let m=v.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if(m){const d1=+m[1],m1=+m[2],y1=+m[3];const dt=new Date(y1,m1-1,d1);if(!isNaN(dt))return dt;}
  m=v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(m){const y2=+m[1],m2=+m[2],d2=+m[3];const dt2=new Date(y2,m2-1,d2);if(!isNaN(dt2))return dt2;}
  const parsed=new Date(v);if(!isNaN(parsed))return parsed;return null;
}
function startOfMonth(d){const x=new Date(d);x.setDate(1);x.setHours(0,0,0,0);return x;}
function endOfMonth(d){const x=new Date(d);x.setMonth(x.getMonth()+1,0);x.setHours(23,59,59,999);return x;}

function parseTimeToMinutes(str){
  if(!str) return Number.POSITIVE_INFINITY;
  const s = String(str).trim().toUpperCase();
  if(!s) return Number.POSITIVE_INFINITY;
  let m = s.match(/^(\d{1,2}):(\d{2})$/);
  if(m){let hh=+m[1], mm=+m[2]; if(hh>=0&&hh<=23&&mm>=0&&mm<=59) return hh*60+mm;}
  m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/);
  if(m){let hh=+m[1], mm=+(m[2]||0); if(hh>=1&&hh<=12&&mm>=0&&mm<=59){if(m[3]==='PM'&&hh!==12) hh+=12; if(m[3]==='AM'&&hh===12) hh=0; return hh*60+mm;}}
  m = s.match(/^(\d{1,2})\.(\d{2})$/);
  if(m){let hh=+m[1], mm=+m[2]; if(hh>=0&&hh<=23&&mm>=0&&mm<=59) return hh*60+mm;}
  m = s.match(/^(\d{1,2})(\d{2})$/);
  if(m){let hh=+m[1], mm=+m[2]; if(hh>=0&&hh<=23&&mm>=0&&mm<=59) return hh*60+mm;}
  return Number.POSITIVE_INFINITY;
}

function cmpTimeAsc(a,b){
  const ta = (a && typeof a.timeMinutes==="number") ? a.timeMinutes : parseTimeToMinutes(a && a.time);
  const tb = (b && typeof b.timeMinutes==="number") ? b.timeMinutes : parseTimeToMinutes(b && b.time);
  if(ta!==tb) return ta - tb;
  const ca = String(a && a.customer || "").localeCompare(String(b && b.customer || ""));
  if(ca!==0) return ca;
  return String(a && a.address || "").localeCompare(String(b && b.address || ""));
}
function cmpDateThenTimeAsc(a,b){
  const ad = a && a.date && a.date.getTime ? a.date.getTime() : 0;
  const bd = b && b.date && b.date.getTime ? b.date.getTime() : 0;
  if(ad!==bd) return ad - bd;
  return cmpTimeAsc(a,b);
}

function useDeliveries(csvUrl){
  const [data,setData]=React.useState([]);
  const [loading,setLoading]=React.useState(true);
  const [error,setError]=React.useState(null);
  const [lastUpdated,setLastUpdated]=React.useState(null);
  const abortRef=React.useRef(null);
  const inFlightRef=React.useRef(false);

  function parseRowsToObjects(rows){
    if(!rows||!rows.length||!Array.isArray(rows[0])) return [];
    const headers=(rows[0]||[]).map(h=>normalizeText(h));
    const lower=headers.map(h=>h.toLowerCase());
    function idxOf(...names){
      const list = Array.isArray(names[0]) ? names[0] : names;
      for(let i=0;i<list.length;i++){
        const idx = lower.indexOf(list[i]);
        if(idx!==-1) return idx;
      }
      return -1;
    }

    const colMap={
      date:idxOf(["date"]),
      customer:idxOf(["customer"]),
      address:idxOf(["delivery address","address"]),
      time:idxOf(["delivery time","time"]),
      notes:idxOf(["notes"]),
      postcode:idxOf(["delivery postcode","postcode"]),
      deliveryType:idxOf(["delivery type","carrier","courier","delivery company","shipper"]),
      doorColour: idxOf(["door colour","door color"]),
      baseUnits:  idxOf(["base units"]),
      wallUnits:  idxOf(["wall units"]),
      baseEnds:   idxOf(["base ends"]),
      wallEnds:   idxOf(["wall ends"]),
      plinths:    idxOf(["plinths"]),
      wtopColour: idxOf(["wtop colour","worktop colour"]),
      wtopLength: idxOf(["wtop length","worktop length"]),
      tekLength:  idxOf(["tek length","s'back length","sback length"]),
      manHours:   idxOf(["man hours","manufacturing hours"])
    };

    const missing=[];
    ["date","customer","address","time"].forEach(k=>{
      if(colMap[k]===-1) missing.push(k);
    });
    if(missing.length){ throw new Error("Missing expected column header(s): "+missing.join(", ")+"."); }

    const items=[];
    for(let r=1;r<rows.length;r++){
      const row=rows[r]||[];
      if(!row || !row.length || row.every(c=>normalizeText(c)==="")) continue;
      const dt=parseDateFromCell(row[colMap.date]); if(!dt) continue;
      dt.setHours(0,0,0,0);
      const timeRaw = normalizeText(row[colMap.time]);
      const delTypeRaw = colMap.deliveryType!==-1 ? normalizeText(row[colMap.deliveryType]) : "";
      const getVal = (idx)=> idx!==-1 ? normalizeText(row[idx]) : "";

      items.push({
        date:dt,
        customer:normalizeText(row[colMap.customer]),
        address:normalizeText(row[colMap.address]),
        time:timeRaw,
        timeMinutes:parseTimeToMinutes(timeRaw),
        notes:colMap.notes!==-1?normalizeText(row[colMap.notes]):"",
        postcode:colMap.postcode!==-1?normalizeText(row[colMap.postcode]):"",
        deliveryType:delTypeRaw,
        manHours:   getVal(colMap.manHours),
        doorColour: getVal(colMap.doorColour),
        wtopColour: getVal(colMap.wtopColour),
        baseUnits:  getVal(colMap.baseUnits),
        wallUnits:  getVal(colMap.wallUnits),
        baseEnds:   getVal(colMap.baseEnds),
        wallEnds:   getVal(colMap.wallEnds),
        plinths:    getVal(colMap.plinths),
        wtopLength: getVal(colMap.wtopLength),
        tekLength:  getVal(colMap.tekLength)
      });
    }
    return items.sort(cmpDateThenTimeAsc);
  }

  async function fetchData(){
    if(inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true); setError(null);

    if(abortRef.current){ try{ abortRef.current.abort(); }catch(_e){} }
    const controller=new AbortController(); abortRef.current = controller;

    try{
      const text=await fetchCsvText(csvUrl,controller.signal);
      const parsed = (window.Papa&&window.Papa.parse)
        ? window.Papa.parse(text,{delimiter:",",skipEmptyLines:false})
        : {data:parseCSVFallback(text)};
      const rows = Array.isArray(parsed && parsed.data) ? parsed.data : [];
      const items = parseRowsToObjects(rows);
      setData(items);
      setLastUpdated(new Date());
    }catch(err){
      if(!(err && (err.name==='AbortError' || String(err).indexOf('AbortError')>-1))){
        console.error(err);
        setError(err && err.message ? err.message : "Failed to load data");
      }
    }finally{
      inFlightRef.current = false;
      setLoading(false);
    }
  }

  const safeRefetch = async()=>{ try{ await fetchData(); }catch(_e){} };

  React.useEffect(()=>{
    fetchData();
    const id=setInterval(fetchData,5*60*1000);
    return ()=>{
      clearInterval(id);
      if(abortRef.current) try{abortRef.current.abort();}catch(_e){} 
    };
  },[csvUrl]);

  return { data, loading, error, refetch:safeRefetch, lastUpdated };
}

function useEqualCardHeights(containerRef, deps){
  useLayoutEffect(()=>{
    const container=containerRef.current; if(!container) return;
    let raf = null;
    const equalize = function(){
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(function(){
        try{
          const cards = container.querySelectorAll('.card');
          if (!cards.length) return;
          cards.forEach(c=>{ c.style.height='auto'; });
          let max = 0;
          cards.forEach(c=>{ const h=c.offsetHeight; if(h>max) max=h; });
          cards.forEach(c=>{ c.style.height = max + 'px'; });
        }catch(e){}
      });
    };
    equalize();
    const onResize = function(){ equalize(); };
    window.addEventListener('resize', onResize, {passive:true});
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(equalize).catch(function(){});
    return function(){
      window.removeEventListener('resize', onResize);
      if (raf) cancelAnimationFrame(raf);
    };
  }, deps||[]);
}
function EqualGrid(props){
  const ref=useRef(null);
  useEqualCardHeights(ref,[props.depKey]);
  return <div ref={ref} className={props.className}>{props.children}</div>;
}

function Badge(props){
  const bg = props.bg; const color = props.color;
  return (
    <span className="badge" style={{background:bg,color:color}}>
      {props.label}
    </span>
  );
}

const DeliveredPill=()=><span className="delivered-pill">Delivered</span>;

function CarrierIcon(props){
  const meta = carrierMetaFromType(props.type);
  if(!meta) return null;
  const cls = "carrier-badge" + (props.small?" small":"");
  return (
    <span className={cls} title={meta.title} aria-label={meta.title}>
      {meta.iconLabel}
    </span>
  );
}

function DeliveryCard(props){
  const delivery = props.delivery || {};
  const date = delivery.date;
  const customer = delivery.customer;
  const address = delivery.address;
  const time = delivery.time;
  const postcode = delivery.postcode;
  const deliveryType = delivery.deliveryType;

  const custStyle=getCustomerStyle(customer);
  const meta = carrierMetaFromType(deliveryType);

  const [copied, setCopied] = React.useState(false);

  const handleCopyAddress = function(e){
    e.stopPropagation();
    // Format: "Address Postcode" (no comma)
    const text = [address, postcode].filter(Boolean).join(' ');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(function(){
          setCopied(true);
          setTimeout(function(){ setCopied(false); }, 2000);
        })
        .catch(function(err){ console.error('Copy failed:', err); });
    } else {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        setTimeout(function(){ setCopied(false); }, 2000);
      } catch (err) {
        console.error('Copy fallback failed:', err);
      }
      document.body.removeChild(textarea);
    }
  };

  const handleOpenMap = function(e){
    e.stopPropagation();
    const query = encodeURIComponent([address, postcode].filter(Boolean).join(', '));
    window.open('https://www.google.com/maps/search/?api=1&query=' + query, '_blank');
  };

  const handleInfo = function(e){
    e.stopPropagation();
    props.onOpen(delivery);
  };

  const handlePrintNote = function(e){
    e.stopPropagation();
    if(props.onPrintNote) {
      props.onPrintNote(delivery);
    }
  };

  // Only show action icons in Operations Dashboard
  const showActionIcons = isOperationsDashboard();

  return (
    <div
      className={"card "+(props.delivered?"delivered ":"")+(showActionIcons?" card-with-actions":"")}
      onClick={!showActionIcons ? function(){ props.onOpen(delivery); } : undefined}
      role="button"
      tabIndex={0}
      onKeyDown={!showActionIcons ? function(e){ if(e.key==='Enter'||e.key===' '){ props.onOpen(delivery); } } : undefined}
    >
      <div className="card-inner">
        <div className="card-header">
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            {props.delivered ? (
              <span className="check-box" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M20.285 6.708a1 1 0 0 1 .007 1.414l-9.192 9.192a1 1 0 0 1-1.414 0L3.707 11.33a1 1 0 1 1 1.414-1.414l5.273 5.273 8.485-8.485a1 1 0 0 1 1.406.004z"/>
                </svg>
              </span>
            ) : null}
            <Badge label={customer||"-"} bg={custStyle.bg} color={custStyle.color}/>
            {props.showCarrierIcon ? <CarrierIcon type={deliveryType} /> : null}
            {props.delivered && props.showDeliveredPill ? <DeliveredPill/> : null}
          </div>
          <span className="card-date">{date ? FMT_CARD_DAY.format(date) : "-"}</span>
        </div>

        <div className="card-body">
          <div className="row"><span className="label">Time</span><span className="value">{time||"-"}</span></div>
          <div className="row"><span className="label">Delivery Address</span><span className="value address-2lines">{address||"-"}</span></div>
          <div className="row"><span className="label">Postcode</span><span className="value">{postcode||"-"}</span></div>
          {props.showCarrierRow ? (
            <div className="row">
              <span className="label">Carrier</span>
              <span className="value">{meta ? meta.printLabel : (deliveryType||"-")}</span>
            </div>
          ) : null}
        </div>
      </div>

      {/* Action Icons Overlay - Operations Dashboard Only */}
      {showActionIcons && (
        <div className="card-actions">
          <button 
            className="action-icon" 
            onClick={handleInfo}
            title="View Details"
            aria-label="View delivery details"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="16" x2="12" y2="12"></line>
              <line x1="12" y1="8" x2="12.01" y2="8"></line>
            </svg>
          </button>
          
          <button 
            className="action-icon" 
            onClick={handlePrintNote}
            title="Print Delivery Note"
            aria-label="Print delivery note"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 6 2 18 2 18 9"></polyline>
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
              <rect x="6" y="14" width="12" height="8"></rect>
            </svg>
          </button>
          
          <button 
            className={"action-icon"+(copied?" copied":"")} 
            onClick={handleCopyAddress}
            title={copied ? "Copied!" : "Copy Address"}
            aria-label="Copy address to clipboard"
          >
            {copied ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            )}
          </button>
          
          <button 
            className="action-icon" 
            onClick={handleOpenMap}
            title="Open in Google Maps"
            aria-label="Open address in Google Maps"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
              <circle cx="12" cy="10" r="3"></circle>
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
DeliveryCard.defaultProps = { delivered:false, showDeliveredPill:true, showCarrierIcon:true, showCarrierRow:true };

function Section(props){
  return (
    <section className={"section " + (props.extraClass||"")}>
      <div className="section-head">
        <div>
          <h2 className="section-title">{props.title}</h2>
          {props.subtitle ? <p className="subtitle">{props.subtitle}</p> : null}
        </div>
        {props.right}
      </div>
      {props.children}
    </section>
  );
}

function TVList(props){
  const items = (props.items||[]).slice().sort(cmpTimeAsc);
  return (
    <table className="tvlist">
      <thead>
        <tr>
          <th style={{width:"8ch"}}>Time</th>
          <th style={{width:"14ch"}}>Customer</th>
          <th style={{width:"16ch"}}>Carrier</th>
          <th>Address</th>
          <th style={{width:"16ch"}}>Postcode</th>
          <th style={{width:"18ch"}}>Date</th>
        </tr>
      </thead>
      <tbody>
        {items.map(function(it,idx){
          const custStyle=getCustomerStyle(it.customer);
          return (
            <tr key={idx} onClick={function(){props.onOpen(it);}}>
              <td><div className="cell">{it.time||"-"}</div></td>
              <td>
                <div className="cell">
                  <span className="chip-badge" style={{background:custStyle.bg,color:custStyle.color}}>
                    {it.customer||"-"}
                  </span>
                </div>
              </td>
              <td>
                <div className="cell">
                  <CarrierIcon type={it.deliveryType} small/>
                  {(!it.deliveryType) ? "-" : null}
                </div>
              </td>
              <td><div className="cell ellipsis">{it.address||"-"}</div></td>
              <td><div className="cell">{it.postcode||"-"}</div></td>
              <td><div className="cell">{it.date ? FMT_TV_DAY.format(it.date) : "-"}</div></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function TVListWeek(props){
  const sorted = (props.items||[]).slice().sort(cmpDateThenTimeAsc);
  const groups = useMemo(function(){
    const out=[]; let currentKey=null, alt=false;
    for(let i=0;i<sorted.length;i++){
      const it=sorted[i];
      const d=it.date; const key = d ? [d.getFullYear(), d.getMonth(), d.getDate()].join('-') : 'na';
      if(key!==currentKey){currentKey=key; alt=!alt; out.push({key:key, date:d, alt:alt, rows:[it]});}
      else{out[out.length-1].rows.push(it);}
    }
    return out;
  },[props.items]);

  return (
    <table className="tvlist-week">
      <colgroup>
        <col className="col-date" />
        <col className="col-time" />
        <col className="col-customer" />
        <col className="col-address" />
        <col className="col-postcode" />
        {isOperationsDashboard() && <col className="col-manhours" />}
        <col className="col-carrier" />
      </colgroup>
      <thead>
        <tr>
          <th><div className="cell center">Date</div></th>
          <th><div className="cell center">Time</div></th>
          <th><div className="cell center">Customer</div></th>
          <th><div className="cell">Address</div></th>
          <th><div className="cell center">Postcode</div></th>
          {isOperationsDashboard() && (
            <th><div className="cell center"><span className="truncate" title="Manufacturing Hours">Manufacturing Hours</span></div></th>
          )}
          <th><div className="cell center">Carrier</div></th>
        </tr>
      </thead>
      <tbody>
        {groups.flatMap(function(g){
          return g.rows.map(function(it,idx){
            const custStyle=getCustomerStyle(it.customer);
            const rowCls = (idx===0 ? 'day-start ' : '') + (g.alt ? 'alt-day' : '');
            const mh = (it.manHours && String(it.manHours).trim()) ? String(it.manHours) : "-";
            return (
              <tr key={g.key + '-' + idx} className={rowCls} onClick={() => props.onOpen(it)}>
                <td><div className="cell center">{it.date ? FMT_TV_DAY.format(it.date) : "-"}</div></td>
                <td><div className="cell center">{it.time||"-"}</div></td>
                <td>
                  <div className="cell center">
                    <span className="chip-badge" style={{background:custStyle.bg,color:custStyle.color}}>
                      {it.customer||"-"}
                    </span>
                  </div>
                </td>
                <td><div className="cell ellipsis">{it.address||"-"}</div></td>
                <td><div className="cell center">{it.postcode||"-"}</div></td>
                {isOperationsDashboard() && (
                  <td><div className="cell center">{mh}</div></td>
                )}
                <td>
                  <div className="cell center">
                    <CarrierIcon type={it.deliveryType}/>
                    {(!it.deliveryType) ? "-" : null}
                  </div>
                </td>
              </tr>
            );
          });
        })}
      </tbody>
    </table>
  );
}

function MobileList(props){
  const list = (props.items||[]).slice().sort(cmpDateThenTimeAsc);
  return (
    <div className="wm-list">
      {list.map(function(it,idx){
        const custStyle=getCustomerStyle(it.customer);
        return (
          <div key={idx} className="wm-row" onClick={function(){props.onOpen(it);}}>
            <div className="wm-line top">
              <span className="chip-badge" style={{background:custStyle.bg,color:custStyle.color}}>
                {it.customer||"-"}
              </span>
              <CarrierIcon type={it.deliveryType} small/>
              {(!it.deliveryType) ? <span className="wm-date-time">-</span> : null}
            </div>
            <div className="wm-line mid">
              <span className="wm-date-time">
                {(it.date ? FMT_TV_DAY.format(it.date) : "-")} &middot; {(it.time||"-")}
              </span>
            </div>
            <div className="wm-line bottom">
              <div className="wm-address-block">
                <span className="wm-address">{it.address||"-"}</span>
                <span className="wm-postcode">{it.postcode||""}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// DEPRECATED: renderDeliveryNote and escapeHtml no longer needed
// Now using dedicated delivery-note.html template
/*
function renderDeliveryNote(delivery){
  const root = document.getElementById('print-note-root');
  if(!root) return;
  const customer = delivery ? delivery.customer : "";
  const date = delivery ? delivery.date : null;
  const time = delivery ? delivery.time : "";
  const theAddress = delivery ? delivery.address : "";
  const notesVal = delivery ? delivery.notes : "";
  const postcode = delivery ? delivery.postcode : "";
  const when = date ? new Intl.DateTimeFormat('en-GB',{day:"2-digit",month:"2-digit",year:"numeric"}).format(date) : "-";

  root.innerHTML = [
    '<div class="sheet">',
    '  <div class="sheet-inner">',
    '    <div class="dn-header">',
    '      <img class="dn-logo" src="./img/wi-logo.svg" alt="Wilson Interiors Logo" />',
    '      <h2 class="dn-title">DELIVERY NOTE</h2>',
    '    </div>',
    '    <div class="dn-info">',
    '      <div class="dn-row"><div class="dn-label">Date</div><div class="dn-value">',escapeHtml(when),'</div></div>',
    '      <div class="dn-row"><div class="dn-label">Time</div><div class="dn-value">',escapeHtml(time||"-"),'</div></div>',
    '      <div class="dn-row"><div class="dn-label">Customer</div><div class="dn-value">',escapeHtml(customer||"-"),'</div></div>',
    '      <div class="dn-row"><div class="dn-label">Delivery Address</div><div class="dn-value">',escapeHtml(theAddress||"-"),'</div></div>',
    '      <div class="dn-row"><div class="dn-label">Postcode</div><div class="dn-value">',escapeHtml(postcode||"-"),'</div></div>',
    '      <div class="dn-row dn-notes"><div class="dn-label">Notes</div><div>',(notesVal ? '<div class="dn-value">'+escapeHtml(notesVal)+'</div>' : ''),'<div class="dn-notes-box"></div></div></div>',
    '    </div>',
    '    <div class="dn-foot">',
    '      <div class="sig"><label>Received By</label><div class="line"></div></div>',
    '      <div class="sig"><label>Signature</label><div class="line"></div></div>',
    '    </div>',
    '  </div>',
    '</div>'
  ].join('');
}
function escapeHtml(str){return String(str).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));}
*/

function openNotePrint(delivery){
  console.log('[Print Note] Preparing delivery note:', delivery);
  
  try {
    // Store delivery data in localStorage
    localStorage.setItem('wilson-delivery-note-print', JSON.stringify(delivery));
    
    // Open dedicated delivery note template in new window
    const noteWindow = window.open('delivery-note.html', '_blank');
    
    if (!noteWindow) {
      alert('Popup blocked! Please allow popups for this site, then try again.');
      localStorage.removeItem('wilson-delivery-note-print');
    }
  } catch (err) {
    console.error('[Print Note] Error:', err);
    alert('Error opening delivery note. Please try again.');
  }
}

function PrintArea(props){
  let list=[], title='';
  const fmtRowDate=new Intl.DateTimeFormat('en-GB',{day:"2-digit",month:"2-digit",year:"2-digit"});

  if(props.mode==='month' && props.monthDate){
    const s=startOfMonth(props.monthDate);
    const e=endOfMonth(props.monthDate);
    title="Deliveries: "+new Intl.DateTimeFormat(undefined,{month:"long",year:"numeric"}).format(s);
    list=(props.data||[]).filter(d=>d.date>=s && d.date<=e).slice().sort(cmpDateThenTimeAsc);
  }else if(props.mode==='nextweek'){
    const next = new Date(startOfWeekMonday(props.weekStart||new Date()));
    next.setDate(next.getDate()+7);
    const mon = startOfWeekMonday(next);
    const fri=new Date(mon); fri.setDate(mon.getDate()+4); fri.setHours(23,59,59,999);
    title = "Week Deliveries (Mon-Fri): "+fmtRowDate.format(mon)+" - "+fmtRowDate.format(fri);
    list=(props.data||[]).filter(d=>d.date>=mon && d.date<=endOfWeekMonday(mon)).slice().sort(cmpDateThenTimeAsc);
  }else{
    const mon=startOfWeekMonday(props.weekStart||new Date());
    const fri=new Date(mon); fri.setDate(mon.getDate()+4); fri.setHours(23,59,59,999);
    title = "Week Deliveries (Mon-Fri): "+fmtRowDate.format(mon)+" - "+fmtRowDate.format(fri);
    list=(props.data||[]).filter(d=>d.date>=mon && d.date<=endOfWeekMonday(mon)).slice().sort(cmpDateThenTimeAsc);
  }

  // Calculate summary totals
  const calculateTotals = (data) => {
    let jcTotal = 0;
    let jcCount = 0;
    let kwlTotal = 0;
    let kwlCount = 0;

    data.forEach(d => {
      const customer = String(d.customer || "").toUpperCase();
      const hours = parseFloat(d.manHours) || 0;
      
      if (hours > 0) {
        // JC group: JC, JC VOID, JC PF, JC HC
        if (customer.includes("JC")) {
          jcTotal += hours;
          jcCount++;
        }
        // KWL group: KWL, KWL STOCK, KWL VOID
        if (customer.includes("KWL")) {
          kwlTotal += hours;
          kwlCount++;
        }
      }
    });

    return {
      jc: { total: jcTotal.toFixed(1), count: jcCount },
      kwl: { total: kwlTotal.toFixed(1), count: kwlCount }
    };
  };

  const totals = calculateTotals(list);

  const abbrev = (text) => {
    const map = {
      "Door Colour": "Door",
      "Worktop Colour": "WTop",
      "# Base Units": "Base",
      "# Wall Units": "Wall",
      "# Base Ends": "BE",
      "# Wall Ends": "WE",
      "# Plinths": "Plth",
      "Worktop Length": "WTL",
      "S'Back Length": "SBL",
      "Manufacturing Hours": "Hrs"
    };
    return map[text] || text;
  };

  return (
    <div id="print-root" aria-hidden="true">
      <h2>{title}</h2>
      <table className="print-table">
        <colgroup>
          <col className="col-carrier" />
          <col className="col-date" />
          <col className="col-time" />
          <col className="col-customer" />
          <col className="col-address" />
          <col className="col-postcode" />
          <col className="col-mfg col-door" />
          <col className="col-mfg col-wtop" />
          <col className="col-mfg" />
          <col className="col-mfg" />
          <col className="col-mfg" />
          <col className="col-mfg" />
          <col className="col-mfg" />
          <col className="col-mfg col-length" />
          <col className="col-mfg col-length" />
          <col className="col-mfg" />
        </colgroup>
        <thead>
          <tr>
            <th>{abbrev("Carrier")}</th>
            <th>{abbrev("Date")}</th>
            <th>{abbrev("Time")}</th>
            <th>{abbrev("Customer")}</th>
            <th>{abbrev("Address")}</th>
            <th>{abbrev("Postcode")}</th>
            <th>{abbrev("Door Colour")}</th>
            <th>{abbrev("Worktop Colour")}</th>
            <th>{abbrev("# Base Units")}</th>
            <th>{abbrev("# Wall Units")}</th>
            <th>{abbrev("# Base Ends")}</th>
            <th>{abbrev("# Wall Ends")}</th>
            <th>{abbrev("# Plinths")}</th>
            <th>{abbrev("Worktop Length")}</th>
            <th>{abbrev("S'Back Length")}</th>
            <th>{abbrev("Manufacturing Hours")}</th>
          </tr>
        </thead>
        <tbody>
          {(list||[]).map(function(d,i){
            const meta = carrierMetaFromType(d.deliveryType);
            const carrierShort = meta ? meta.printLabel : (d.deliveryType||"");
            return (
              <tr key={i}>
                <td className="nowrap">{carrierShort}</td>
                <td className="nowrap">{fmtRowDate.format(d.date)}</td>
                <td className="nowrap">{d.time||""}</td>
                <td className="nowrap">{d.customer||""}</td>
                <td className="wrap">{d.address||""}</td>
                <td className="nowrap">{d.postcode||""}</td>
                <td className="nowrap">{d.doorColour||""}</td>
                <td className="nowrap">{d.wtopColour||""}</td>
                <td className="nowrap">{d.baseUnits||""}</td>
                <td className="nowrap">{d.wallUnits||""}</td>
                <td className="nowrap">{d.baseEnds||""}</td>
                <td className="nowrap">{d.wallEnds||""}</td>
                <td className="nowrap">{d.plinths||""}</td>
                <td className="nowrap">{d.wtopLength||""}</td>
                <td className="nowrap">{d.tekLength||""}</td>
                <td className="nowrap">{d.manHours||""}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="summary-row">
            <td colSpan="16" className="summary-cell">
              <div className="summary-totals">
                <div className="summary-item">
                  <strong>JC Total:</strong> {totals.jc.total} hrs across {totals.jc.count} {totals.jc.count === 1 ? 'delivery' : 'deliveries'}
                </div>
                <div className="summary-item">
                  <strong>KWL Total:</strong> {totals.kwl.total} hrs across {totals.kwl.count} {totals.kwl.count === 1 ? 'delivery' : 'deliveries'}
                </div>
              </div>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function MonthPicker(props){
  const [v,setV]=useState(props.value);
  React.useEffect(function(){ setV(props.value); },[props.value]);
  function setAndNotify(nv){ setV(nv); if(props.onChange) props.onChange(nv); }
  const now=new Date();
  
  // Parse current month
  const parts = (/^\d{4}-\d{2}$/.test(v||"")) ? v.split('-') : [String(now.getFullYear()), String(now.getMonth()+1).padStart(2,'0')];
  const yy = Number(parts[0]); const mm = Number(parts[1]);
  
  // Format as "Nov 2025"
  const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const displayText = monthNames[mm-1] + " " + yy;
  
  // Generate month options for dropdown (last 6 months to next 6 months)
  const monthOptions = [];
  for(let i = -6; i <= 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const value = y + "-" + String(m).padStart(2,'0');
    const label = monthNames[m-1] + " " + y;
    monthOptions.push({value, label});
  }
  
  return (
    <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
      <span>{props.label}</span>
      <button type="button" className="btn small" onClick={function(){setAndNotify(stepMonthStr(v,-1));}} aria-label="Previous month">&#8249;</button>
      <select 
        value={v} 
        onChange={function(e){setAndNotify(e.target.value);}}
        style={{
          minWidth:'120px',
          padding:'6px 28px 6px 10px',
          borderRadius:'10px',
          background:'rgba(255,255,255,.06)',
          border:'1px solid rgba(255,255,255,0.18)',
          color:'var(--text-primary)',
          fontSize:'12px',
          fontWeight:'700',
          cursor:'pointer'
        }}
        aria-label="Select month"
      >
        {monthOptions.map(function(opt){
          return <option key={opt.value} value={opt.value} style={{background:'#1a1a3e',color:'#ffffff'}}>{opt.label}</option>;
        })}
      </select>
      <button type="button" className="btn small" onClick={function(){setAndNotify(stepMonthStr(v,1));}} aria-label="Next month">&#8250;</button>
    </div>
  );
}
function stepMonthStr(monthStr, delta){
  if(!(/^\d{4}-\d{2}$/.test(monthStr||""))){
    const now=new Date();
    const y=now.getFullYear(), m=String(now.getMonth()+1).padStart(2,'0');
    monthStr=y+"-"+m;
  }
  const parts=monthStr.split('-');
  const y=Number(parts[0]), m=Number(parts[1]);
  const d=new Date(y, m-1, 1);
  d.setMonth(d.getMonth()+delta, 1);
  const ny=d.getFullYear(), nm=String(d.getMonth()+1).padStart(2,'0');
  return ny+"-"+nm;
}

function WeekPicker(props){
  const [v,setV]=useState(props.value);
  React.useEffect(function(){ setV(props.value); },[props.value]);
  function setAndNotify(nv){ setV(nv); if(props.onChange) props.onChange(nv); }
  
  // Parse week start date
  const weekStart = /^\d{4}-\d{2}-\d{2}$/.test(v||"") 
    ? new Date(v + 'T00:00:00') 
    : startOfWeekMonday(new Date());
  
  // Format week range as "Mon 04 Nov - Sun 10 Nov 2024"
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  
  const formatWeekDisplay = function(start, end) {
    const startDay = new Intl.DateTimeFormat('en-GB', {weekday:'short', day:'2-digit', month:'short'}).format(start);
    const endFmt = new Intl.DateTimeFormat('en-GB', {weekday:'short', day:'2-digit', month:'short', year:'numeric'}).format(end);
    return startDay + " - " + endFmt;
  };
  
  // Generate week options (last 8 weeks to next 4 weeks)
  const weekOptions = [];
  const today = new Date();
  const currentWeekStart = startOfWeekMonday(today);
  
  for(let i = -8; i <= 4; i++) {
    const weekDate = new Date(currentWeekStart);
    weekDate.setDate(currentWeekStart.getDate() + (i * 7));
    const ws = startOfWeekMonday(weekDate);
    const we = new Date(ws);
    we.setDate(ws.getDate() + 6);
    
    const value = ws.getFullYear() + "-" + 
                  String(ws.getMonth() + 1).padStart(2,'0') + "-" + 
                  String(ws.getDate()).padStart(2,'0');
    const label = formatWeekDisplay(ws, we);
    
    weekOptions.push({value, label, isCurrent: i === 0});
  }
  
  // Step week by delta
  function stepWeek(delta) {
    const current = new Date(weekStart);
    current.setDate(current.getDate() + (delta * 7));
    const newWeekStart = startOfWeekMonday(current);
    const newValue = newWeekStart.getFullYear() + "-" + 
                     String(newWeekStart.getMonth() + 1).padStart(2,'0') + "-" + 
                     String(newWeekStart.getDate()).padStart(2,'0');
    setAndNotify(newValue);
  }
  
  return (
    <div style={{display:'flex',alignItems:'center',gap:'6px',flexWrap:'wrap'}}>
      <span>{props.label}</span>
      <button 
        type="button" 
        className="btn small" 
        onClick={function(){stepWeek(-1);}} 
        aria-label="Previous week"
      >
        &#8249;
      </button>
      <select 
        value={v} 
        onChange={function(e){setAndNotify(e.target.value);}}
        style={{
          minWidth:'240px',
          padding:'6px 28px 6px 10px',
          borderRadius:'10px',
          background:'rgba(255,255,255,.06)',
          border:'1px solid rgba(255,255,255,0.18)',
          color:'var(--text-primary)',
          fontSize:'12px',
          fontWeight:'700',
          cursor:'pointer'
        }}
        aria-label="Select week"
      >
        {weekOptions.map(function(opt){
          return (
            <option 
              key={opt.value} 
              value={opt.value} 
              style={{background:'#1a1a3e',color:'#ffffff'}}
            >
              {opt.isCurrent ? '→ ' : ''}{opt.label}
            </option>
          );
        })}
      </select>
      <button 
        type="button" 
        className="btn small" 
        onClick={function(){stepWeek(1);}} 
        aria-label="Next week"
      >
        &#8250;
      </button>
    </div>
  );
}

function PrintOptions(props){
  const [mode,setMode]=useState('week');
  const [weekStartStr,setWeekStartStr]=useState(props.defaultWeekStartStr);
  const [monthStr,setMonthStr]=useState(props.defaultMonthStr);
  const [includeHoursColumn,setIncludeHoursColumn]=useState(true);
  const [customerFilter,setCustomerFilter]=useState('ALL');
  const [includeFollowingMonday,setIncludeFollowingMonday]=useState(false);
  
  // Handle Escape key to close modal
  React.useEffect(function(){
    if(!props.open) return;
    
    const handleEscape = function(e){
      if(e.key === 'Escape'){
        e.preventDefault();
        props.onClose();
      }
    };
    
    document.addEventListener('keydown', handleEscape);
    return function(){ document.removeEventListener('keydown', handleEscape); };
  },[props.open, props.onClose]);
  
  // Lock body scroll when modal is open
  React.useEffect(function(){
    if(!props.open) return;
    const scrollY = window.scrollY;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';
    document.body.style.overflowY = 'scroll';
    return function(){
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      document.body.style.overflowY = '';
      window.scrollTo(0, scrollY);
    };
  },[props.open]);
  
  if(!props.open) return null;
  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={function(e){e.stopPropagation();}}>
        <div className="modal-header">
          <h3 className="modal-title">Print Options</h3>
          <button className="close-btn" onClick={props.onClose} aria-label="Close">Close &#10006;</button>
        </div>
        
        <div style={{display:'grid',gap:16,fontSize:"14px",lineHeight:"1.4"}}>
          {/* Week Selector */}
          <div style={{display:'grid',gap:'12px',padding:'12px',borderRadius:'12px',background:'rgba(255,255,255,.04)',border:mode==='week'?'2px solid var(--primary)':'1px solid var(--border-subtle)'}}>
            <label style={{display:'flex',alignItems:'center',gap:'8px',cursor:'pointer'}}>
              <input 
                type="radio" 
                name="print-mode" 
                value="week" 
                checked={mode==='week'} 
                onChange={()=>setMode('week')}
                style={{width:'18px',height:'18px',cursor:'pointer'}}
              />
              <span style={{fontWeight:'700',fontSize:'15px'}}>Print Week</span>
            </label>
            <WeekPicker
              value={weekStartStr}
              onChange={setWeekStartStr}
              label="Select week:"
            />
            <small style={{color:"#a0a9c0",fontSize:"12px",marginLeft:'26px',display:'block'}}>
              Prints Monday-Sunday for the selected week
            </small>
            <label style={{display:'flex',alignItems:'center',gap:'8px',cursor:'pointer',marginTop:'8px',marginLeft:'26px'}}>
              <input
                type="checkbox"
                checked={includeFollowingMonday}
                onChange={(e)=>setIncludeFollowingMonday(e.target.checked)}
                disabled={mode!=='week'}
                style={{width:'16px',height:'16px',cursor:'pointer'}}
              />
              <span style={{fontWeight:'600',fontSize:'13px'}}>Include following Monday</span>
            </label>
          </div>

          {/* Month Selector */}
          <div style={{display:'grid',gap:'12px',padding:'12px',borderRadius:'12px',background:'rgba(255,255,255,.04)',border:mode==='month'?'2px solid var(--primary)':'1px solid var(--border-subtle)'}}>
            <label style={{display:'flex',alignItems:'center',gap:'8px',cursor:'pointer'}}>
              <input 
                type="radio" 
                name="print-mode" 
                value="month" 
                checked={mode==='month'} 
                onChange={()=>setMode('month')}
                style={{width:'18px',height:'18px',cursor:'pointer'}}
              />
              <span style={{fontWeight:'700',fontSize:'15px'}}>Print Month</span>
            </label>
            <MonthPicker 
              value={monthStr} 
              onChange={setMonthStr} 
              label="Select month:"
            />
            <small style={{color:"#a0a9c0",fontSize:"12px",marginLeft:'26px',display:'block'}}>
              Prints all deliveries for the selected month
            </small>
          </div>
          
          {/* Customer Filter - Independent Section */}
          <div style={{marginTop:'8px',paddingTop:'12px',borderTop:'1px solid rgba(255,255,255,0.1)'}}>
            <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'8px'}}>
              <span style={{fontWeight:'600',fontSize:'13px'}}>Filter by customer:</span>
              <label className="select" style={{minWidth:'140px'}}>
                <select
                  value={customerFilter}
                  onChange={(e)=>setCustomerFilter(e.target.value)}
                  aria-label="Filter by customer"
                >
                  <option value="ALL">All Customers</option>
                  <option value="JC">JC (all variants)</option>
                  <option value="KWL">KWL (all variants)</option>
                </select>
              </label>
            </div>
            <small style={{color:"#a0a9c0",fontSize:"12px",display:'block'}}>
              Filter deliveries by customer group (works with or without hours column)
            </small>
          </div>
          
          {/* Manufacturing Hours Toggle */}
          <div style={{marginTop:'8px',paddingTop:'12px',borderTop:'1px solid rgba(255,255,255,0.1)'}}>
            <label style={{display:'flex',alignItems:'center',gap:'8px',cursor:'pointer'}}>
              <input 
                type="checkbox" 
                checked={includeHoursColumn} 
                onChange={(e)=>setIncludeHoursColumn(e.target.checked)}
                style={{width:'16px',height:'16px',cursor:'pointer'}}
              />
              <span style={{fontWeight:'600'}}>Include manufacturing hours column</span>
            </label>
            <small style={{color:"#a0a9c0",fontSize:"12px",marginLeft:'24px',display:'block',marginTop:'4px'}}>
              Shows manufacturing hours, door colours, worktop details, and unit counts
            </small>
          </div>
          
          {/* Action Buttons */}
          <div style={{display:'flex',gap:'8px',justifyContent:'flex-end',marginTop:'8px'}}>
            <button className="close-btn" onClick={props.onClose}>Cancel</button>
            <button 
              className="close-btn" 
              style={{
                background:'linear-gradient(135deg,rgba(0,212,255,.25),rgba(0,153,204,.25))',
                borderColor:'var(--primary)',
                fontWeight:'700'
              }} 
              onClick={()=>props.onConfirm({
                mode: mode,
                weekStartStr: mode === 'week' ? weekStartStr : undefined,
                monthStr: mode === 'month' ? monthStr : undefined,
                includeHoursColumn: includeHoursColumn,
                customerFilter: customerFilter,
                includeFollowingMonday: mode === 'week' ? includeFollowingMonday : false
              })}
            >
              <i className="fa-solid fa-print"></i> Open Print Preview
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DeliveryModal(props){
  const delivery = props.delivery;
  
  // Handle Escape key to close modal
  React.useEffect(function(){
    if(!delivery) return;
    
    const handleEscape = function(e){
      if(e.key === 'Escape'){
        e.preventDefault();
        props.onClose();
      }
    };
    
    document.addEventListener('keydown', handleEscape);
    return function(){ document.removeEventListener('keydown', handleEscape); };
  },[delivery, props.onClose]);
  
  // Lock body scroll when modal is open
  React.useEffect(function(){
    if(!delivery) return;
    const scrollY = window.scrollY;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';
    document.body.style.overflowY = 'scroll';
    return function(){
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      document.body.style.overflowY = '';
      window.scrollTo(0, scrollY);
    };
  },[delivery]);
  
  if(!delivery) return null;
  const customer = delivery.customer;
  const date = delivery.date;
  const time = delivery.time;
  const address = delivery.address;
  const notes = delivery.notes;
  const postcode = delivery.postcode;
  const deliveryType = delivery.deliveryType;
  const fmtLong=new Intl.DateTimeFormat(undefined,{weekday:"long",day:"2-digit",month:"long",year:"numeric"}).format(date);
  const meta = carrierMetaFromType(deliveryType);

  // Only show manufacturing info in Operations Dashboard
  const extras = isOperationsDashboard() ? [
    { label:"Manufacturing Hours", value:delivery.manHours },
    { label:"Door Colour",        value:delivery.doorColour },
    { label:"Worktop Colour",     value:delivery.wtopColour },
    { label:"# Base Units",       value:delivery.baseUnits },
    { label:"# Wall Units",       value:delivery.wallUnits },
    { label:"# Base Ends",        value:delivery.baseEnds },
    { label:"# Wall Ends",        value:delivery.wallEnds },
    { label:"# Plinths",          value:delivery.plinths },
    { label:"Worktop Length",     value:delivery.wtopLength },
    { label:"S'Back Length",      value:delivery.tekLength }
  ].filter(function(e){
    const v = e && e.value;
    return !(v==null || String(v).trim()==="");
  }) : [];

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={function(e){e.stopPropagation();}}>
        <div className="modal-header">
          <h3 className="modal-title">{address ? address : "Delivery Details"}</h3>
          <div style={{display:'flex',gap:'8px',alignItems:'center',flexWrap:'wrap'}}>
            {isOperationsDashboard() && (
              <button className="btn small btn-print-note" onClick={function(){props.onPrintNote(delivery);}} title="Print Delivery Note" aria-label="Print Delivery Note"><i className="fa-solid fa-print"></i> Delivery Note</button>
            )}
            <button className="close-btn" onClick={props.onClose} aria-label="Close">Close &#10006;</button>
          </div>
        </div>

        <div className="modal-grid">
          {extras.length>0 ? (<div className="modal-subhead">MANUFACTURING INFORMATION</div>) : null}

          {
            extras.map(function(e,i){
              return (
                <React.Fragment key={i}>
                  <div className="label">{e.label}</div>
                  <div className="value">{String(e.value)}</div>
                </React.Fragment>
              );
            })
          }

          {extras.length>0 ? <div className="modal-sep" role="separator" aria-hidden="true"></div> : null}

          <div className="modal-subhead">DELIVERY INFORMATION</div>

          <div className="label">Carrier</div>
          <div className="value">{meta ? meta.printLabel : (deliveryType||"-")}</div>

          <div className="label">Customer</div>
          <div className="value">{customer||"-"}</div>

          <div className="label">Date</div>
          <div className="value">{fmtLong}</div>

          <div className="label">Time</div>
          <div className="value">{time||"-"}</div>

          <div className="label">Address</div>
          <div className="value">{address||"-"}</div>

          <div className="label">Postcode</div>
          <div className="value">{postcode||"-"}</div>

          <div className="label">Notes</div>
          <div className="value">{notes||"-"}</div>
        </div>
      </div>
    </div>
  );
}

/* ------- SearchModal: single column, compact, scrollable ------- */
function SearchModal(props){
  const [q,setQ]=useState("");
  const inputRef = useRef(null);

  // Focus input when modal opens
  React.useEffect(function(){
    if(props.open){
      requestAnimationFrame(function(){
        try{ if(inputRef.current) inputRef.current.focus(); }catch(_e){}
      });
    }
  },[props.open]);

  // Handle Escape key globally for this modal
  React.useEffect(function(){
    if(!props.open) return;
    
    const handleEscape = function(e){
      if(e.key === 'Escape'){
        e.preventDefault();
        props.onClose();
      }
    };
    
    document.addEventListener('keydown', handleEscape);
    return function(){ document.removeEventListener('keydown', handleEscape); };
  },[props.open, props.onClose]);
  
  // Lock body scroll when modal is open
  React.useEffect(function(){
    if(!props.open) return;
    const scrollY = window.scrollY;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';
    document.body.style.overflowY = 'scroll';
    return function(){
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      document.body.style.overflowY = '';
      window.scrollTo(0, scrollY);
    };
  },[props.open]);

  if(!props.open) return null;

  const query = (typeof q === 'string' ? q : String(q||"")).trim().toUpperCase();

  // Build filtered list
  let filtered = [];
  try{
    if(query.length>=2){
      const src = Array.isArray(props.data) ? props.data : [];
      filtered = src
        .filter(d=>{
          if(!d || typeof d !== 'object') return false;
          const pc = String(d.postcode==null ? "" : d.postcode).toUpperCase();
          return pc.indexOf(query)>-1;
        })
        .slice()
        .sort(cmpDateThenTimeAsc);
    }
  }catch(_err){ filtered = []; }

  // Group by postcode
  const groupsMap = new Map();
  for(const it of filtered){
    const pc = String(it.postcode||"-").toUpperCase();
    if(!groupsMap.has(pc)) groupsMap.set(pc, []);
    groupsMap.get(pc).push(it);
  }
  const groups = Array.from(groupsMap.entries()).map(([pc, items])=>{
    const sorted = items.slice().sort(cmpDateThenTimeAsc);
    const next = sorted[0];
    return {
      postcode: pc,
      count: items.length,
      next,
      address: next ? next.address : "",
      dateLabel: next && next.date ? FMT_TV_DAY.format(next.date) : "-",
      timeLabel: next ? (next.time||"-") : "-",
      customer: next ? next.customer : "",
      carrier: next ? next.deliveryType : ""
    };
  }).sort((a,b)=> a.postcode.localeCompare(b.postcode));

  function openGroup(g){
    if(g && g.next) props.onPick(g.next);
  }

  // compute viewport-aware height for the scroll container
  const maxBodyPx = Math.max(260, Math.min(window.innerHeight ? window.innerHeight - 280 : 480, 620));

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={function(e){e.stopPropagation();}}>
        <div className="modal-header">
          <h3 className="modal-title">Search by Postcode</h3>
          <button className="close-btn" onClick={props.onClose} aria-label="Close">Close &#10006;</button>
        </div>

        <div className="search-bar">
          <input
            ref={inputRef}
            className="search-input"
            type="text"
            placeholder="Type a postcode (e.g. HU6, HU6 7HW)"
            value={q}
            onChange={function(e){setQ(e.target.value);}}
            onKeyDown={function(e){ if(e.key==='Escape') props.onClose(); }}
            aria-label="Postcode search"
          />
          <span className="search-help">Enter at least 2 characters. Results update as you type.</span>
        </div>

        <div
          className="search-body"
          style={{maxHeight: maxBodyPx+'px'}}
          role="region"
          aria-label="Postcode results"
        >
          {query.length<2 ? (
            <div className="status">Start typing a postcode to see results.</div>
          ) : (groups.length===0 ? (
            <div className="status">No deliveries found for that postcode.</div>
          ) : (
            <div className="search-grid" role="listbox">
              {groups.map(function(g,idx){
                const custStyle=getCustomerStyle(g.customer);
                const meta = carrierMetaFromType(g.carrier);
                return (
                  <div
                    key={g.postcode+"-"+idx}
                    className="result-card"
                    role="option"
                    tabIndex={0}
                    onClick={function(){openGroup(g);}}
                    onKeyDown={function(e){ if(e.key==='Enter' || e.key===' ') openGroup(g); }}
                    title={"Open next delivery for "+g.postcode}
                  >
                    <div className="result-top">
                      <span className="chip-badge postcode-pill" style={{background:custStyle.bg,color:custStyle.color}}>
                        {g.postcode}
                      </span>
                      <span className="count-pill" aria-label={"Count"}>{g.count}</span>
                    </div>
                    <div className="result-body">
                      <div className="meta-row">
                        {g.dateLabel} &middot; {g.timeLabel} {meta ? ("&middot; "+meta.printLabel) : ""}
                      </div>
                      <div className="addr-row">{g.address||"-"}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function App(){
  const {data,loading,error,refetch,lastUpdated}=useDeliveries(SHEET_CSV_URL);

  const today=new Date(); today.setHours(0,0,0,0);
  const tomorrow=new Date(today); tomorrow.setDate(today.getDate()+1);
  const yesterday=new Date(today); yesterday.setDate(yesterday.getDate()-1);

  const [weekOffset,setWeekOffset]=useState(0);

  const weekStartRef = useRef(startOfWeekMonday(new Date()));
  const baseWeekStart = weekStartRef.current;

  const [openDelivery,setOpenDelivery]=useState(null);

  const [printMode,setPrintMode]=useState('week');
  const [printMonthDate,setPrintMonthDate]=useState(new Date());
  const [showPrint,setShowPrint]=useState(false);

  const [customerFilter,setCustomerFilter]=useState('ALL');
  const [carrierFilter,setCarrierFilter]=useState('ALL');

  const [showSearch,setShowSearch]=useState(false);

  const isPrintingRef = React.useRef(false);
  const nextHardReloadTsRef = React.useRef(null);

  /* Hourly hard reload */
  React.useEffect(function(){
    const onBeforePrint = function(){ isPrintingRef.current = true; };
    const onAfterPrint  = function(){ isPrintingRef.current = false; };
    window.addEventListener('beforeprint', onBeforePrint);
    window.addEventListener('afterprint',  onAfterPrint);

    const scheduleNextTopOfHour = function(){
      const now = new Date();
      const nextHour = new Date(now);
      nextHour.setMinutes(0, 0, 0);
      nextHour.setHours(now.getHours() + 1);
      nextHardReloadTsRef.current = nextHour.getTime();
      return nextHour.getTime() - now.getTime();
    };

    const tick = function(){
      if (!isPrintingRef.current && nextHardReloadTsRef.current != null && Date.now() >= nextHardReloadTsRef.current) {
        window.location.reload();
      }
    };

    const firstDelay = scheduleNextTopOfHour();
    const firstTimeoutId = setTimeout(tick, firstDelay);

    const minuteIntervalId = setInterval(tick, 60 * 1000);

    return function(){
      clearTimeout(firstTimeoutId);
      clearInterval(minuteIntervalId);
      window.removeEventListener('beforeprint', onBeforePrint);
      window.removeEventListener('afterprint', onAfterPrint);
    };
  }, []);

  // Gate refetch on focus/visibility to only run if data is stale (>10min)
  React.useEffect(function(){
    const STALE_MS = 10 * 60 * 1000;
    const onVisible = function(){
      if (document.visibilityState === 'visible') {
        const last = lastUpdated && lastUpdated.getTime ? lastUpdated.getTime() : 0;
        if (!last || (Date.now() - last) > STALE_MS) { refetch(); }
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return function(){
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [refetch, lastUpdated]);

  const customerOptions = useMemo(function(){
    const set=new Set();
    (data||[]).forEach(function(d){ const name = normalizeText(d.customer); if(name) set.add(name); });
    return Array.from(set).sort(function(a,b){return a.localeCompare(b);});
  },[data]);

  const carrierOptions = useMemo(function(){
    const set=new Set();
    (data||[]).forEach(function(d){
      const meta=carrierMetaFromType(d.deliveryType);
      const label = meta ? meta.printLabel : normalizeText(d.deliveryType);
      if(label) set.add(label);
    });
    return Array.from(set).sort(function(a,b){return a.localeCompare(b);});
  },[data]);

  function normalizeCarrierLabel(raw){
    const meta=carrierMetaFromType(raw);
    return meta ? meta.printLabel : normalizeText(raw);
  }

  function applyFilters(list){
    let out = list||[];
    if(customerFilter!=='ALL'){ out = out.filter(function(d){return normalizeText(d.customer)===customerFilter;}); }
    if(carrierFilter!=='ALL'){ out = out.filter(function(d){return normalizeCarrierLabel(d.deliveryType)===carrierFilter;}); }
    return out;
  }

  const weekStart=useMemo(function(){
    const d=new Date(baseWeekStart);
    d.setDate(baseWeekStart.getDate()+weekOffset*7);
    return d;
  },[baseWeekStart,weekOffset]);

  const todaysDeliveries=useMemo(function(){
    const base = (data||[]).filter(function(d){return isSameDay(d.date,today);}).slice().sort(cmpTimeAsc);
    return applyFilters(base);
  },[data,today,customerFilter,carrierFilter]);

  function nextDateWithDeliveries(fromDate){
    let target=null;
    const arr = (data||[]);
    for(let i=0;i<arr.length;i++){
      const d=arr[i];
      if(d.date>=fromDate){
        if(!target || d.date < target) target = d.date;
        if(target && d.date.getTime()>target.getTime()) break;
      }
    }
    return target;
  }

  const targetTomorrowDate = React.useMemo(function(){
    const hasTomorrow = (data||[]).some(function(d){return isSameDay(d.date,tomorrow);});
    if(hasTomorrow) return tomorrow;
    return nextDateWithDeliveries(new Date(tomorrow));
  },[data,tomorrow]);

  const tomorrowsDeliveries = React.useMemo(function(){
    if(!targetTomorrowDate) return [];
    const base = (data||[]).filter(function(d){return isSameDay(d.date,targetTomorrowDate);}).slice().sort(cmpTimeAsc);
    return applyFilters(base);
  },[data,targetTomorrowDate,customerFilter,carrierFilter]);

  const tomorrowSectionTitle = React.useMemo(function(){
    if(!targetTomorrowDate) return "Tomorrow's Deliveries";
    if(isSameDay(targetTomorrowDate,tomorrow)) return "Tomorrow's Deliveries";
    const dayName = new Intl.DateTimeFormat(undefined,{weekday:"long"}).format(targetTomorrowDate);
    return dayName + "'s Deliveries";
  },[targetTomorrowDate,tomorrow]);

  const tomorrowSectionSubtitle = React.useMemo(function(){
    const fmt = new Intl.DateTimeFormat(undefined,{weekday:"long",day:"2-digit",month:"long",year:"numeric"});
    return targetTomorrowDate ? fmt.format(targetTomorrowDate) : fmt.format(tomorrow);
  },[targetTomorrowDate,tomorrow]);

  const yesterdayDeliveries=useMemo(function(){
    const base = (data||[]).filter(function(d){return isSameDay(d.date,yesterday);}).slice().sort(cmpTimeAsc);
    return applyFilters(base);
  },[data,yesterday,customerFilter,carrierFilter]);

  const weekRemainingThisWeek = useMemo(function(){
    const mon = startOfWeekMonday(baseWeekStart);
    const sun = endOfWeekMonday(baseWeekStart);
    return applyFilters(
      (data||[])
        .filter(function(d){return d.date>=tomorrow && d.date>=mon && d.date<=sun;})
        .filter(function(d){ return !(targetTomorrowDate && isSameDay(d.date, targetTomorrowDate)); })
    );
  },[data,baseWeekStart,tomorrow,targetTomorrowDate,customerFilter,carrierFilter]);

  function findNextWeekWithDeliveries(fromWeekStartExclusive){
    const start = startOfWeekMonday(fromWeekStartExclusive);
    start.setDate(start.getDate()+7);
    for(let i=0;i<104;i++){
      const ws = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i*7);
      const we = endOfWeekMonday(ws);
      const has = (data||[]).some(function(d){return d.date>=ws && d.date<=we;});
      if(has) return ws;
    }
    return null;
  }

  const computedWeek = useMemo(function(){
    if(weekOffset!==0){
      // Show full selected week, even if in the past
      return {
        start: weekStart,
        title:"Deliveries Week Commencing " + FMT_WC.format(startOfWeekMonday(weekStart)),
        subtitle: formatWeekRange(weekStart),
        items: applyFilters((data||[])
          .filter(function(d){return withinWeek(d.date,weekStart);} )
          .slice().sort(cmpDateThenTimeAsc))
      };
    }

    if(weekRemainingThisWeek.length>0){
      return {
        start: baseWeekStart,
        title:"Rest of the Week's Deliveries",
        subtitle: formatWeekRange(baseWeekStart),
        items: weekRemainingThisWeek.slice().sort(cmpDateThenTimeAsc)
      };
    }

    const nextWeekStart = findNextWeekWithDeliveries(baseWeekStart);
    if(nextWeekStart){
      const baseItems = (data||[])
        .filter(function(d){return withinWeek(d.date,nextWeekStart);})
        .slice().sort(cmpDateThenTimeAsc);

      const filteredItems = targetTomorrowDate
        ? baseItems.filter(function(d){return !isSameDay(d.date, targetTomorrowDate);})
        : baseItems;
      return {
        start: nextWeekStart,
        title:"Deliveries Week Commencing " + FMT_WC.format(nextWeekStart),
        subtitle: formatWeekRange(nextWeekStart),
        items: applyFilters(filteredItems)
      };
    }

    return {
      start: baseWeekStart,
      title:"Rest of the Week's Deliveries",
      subtitle: formatWeekRange(baseWeekStart),
      items: []
    };
  },[
    weekOffset,weekStart,baseWeekStart,data,today,
    weekRemainingThisWeek,targetTomorrowDate,customerFilter,carrierFilter
  ]);

  const tvModeThreshold=18;
  const manyToday=todaysDeliveries.length>=tvModeThreshold;
  const manyTomorrow=tomorrowsDeliveries.length>=tvModeThreshold;

  const defaultMonthStr = useMemo(function(){
    const now=new Date();
    const y=now.getFullYear();
    const m=(now.getMonth()+1).toString().padStart(2,'0');
    return y + "-" + m;
  },[]);

  const defaultWeekStartStr = useMemo(function(){
    const now = new Date();
    const ws = startOfWeekMonday(now);
    return ws.getFullYear() + "-" + 
           String(ws.getMonth() + 1).padStart(2,'0') + "-" + 
           String(ws.getDate()).padStart(2,'0');
  },[]);

  function setHtmlPrintMode(mode){
    const el = document.documentElement;
    if (mode) el.setAttribute('data-print', mode);
    else el.removeAttribute('data-print');
  }

  function openListPrint(opts){
    console.log('[Print List] Preparing print with options:', opts);
    
    try {
      // Determine title and filter deliveries
      let title = '';
      let list = [];
      const fmtRowDate = new Intl.DateTimeFormat('en-GB', {day:"2-digit", month:"2-digit", year:"2-digit"});
      
      if (opts.mode === 'month' && opts.monthStr) {
        const ms = (opts.monthStr && /^\d{4}-\d{2}$/.test(opts.monthStr)) ? opts.monthStr : defaultMonthStr;
        const parts = ms.split('-');
        const y = Number(parts[0]);
        const m = Number(parts[1]);
        const monthDate = new Date(y, m-1, 1);
        const s = startOfMonth(monthDate);
        const e = endOfMonth(monthDate);
        title = "Deliveries: " + new Intl.DateTimeFormat(undefined, {month:"long", year:"numeric"}).format(s);
        list = (data||[]).filter(d => d.date >= s && d.date <= e).slice().sort(cmpDateThenTimeAsc);
      } else if (opts.mode === 'week' && opts.weekStartStr) {
        // Parse week start date from YYYY-MM-DD format
        const ws = /^\d{4}-\d{2}-\d{2}$/.test(opts.weekStartStr)
          ? new Date(opts.weekStartStr + 'T00:00:00')
          : startOfWeekMonday(new Date());

        const mon = startOfWeekMonday(ws);
        const sun = endOfWeekMonday(mon);

        if (opts.includeFollowingMonday) {
          // Tuesday of current week
          const tue = new Date(mon);
          tue.setDate(tue.getDate() + 1);
          // Friday of current week (end of day)
          const fri = new Date(mon);
          fri.setDate(fri.getDate() + 4);
          fri.setHours(23, 59, 59, 999);
          // Following Monday
          const followingMon = new Date(mon);
          followingMon.setDate(followingMon.getDate() + 7);
          const followingMonEnd = new Date(followingMon);
          followingMonEnd.setHours(23, 59, 59, 999);

          title = "Week Deliveries: Tue " + fmtRowDate.format(tue) + " - Fri " + fmtRowDate.format(fri) + " + Mon " + fmtRowDate.format(followingMon);
          list = (data||[]).filter(d => (d.date >= tue && d.date <= fri) || (d.date >= followingMon && d.date <= followingMonEnd)).slice().sort(cmpDateThenTimeAsc);
        } else {
          title = "Week Deliveries: " + fmtRowDate.format(mon) + " - " + fmtRowDate.format(sun);
          list = (data||[]).filter(d => d.date >= mon && d.date <= sun).slice().sort(cmpDateThenTimeAsc);
        }
      } else {
        // Fallback to current week
        const mon = startOfWeekMonday(new Date());
        const sun = endOfWeekMonday(mon);
        title = "Week Deliveries: " + fmtRowDate.format(mon) + " - " + fmtRowDate.format(sun);
        list = (data||[]).filter(d => d.date >= mon && d.date <= sun).slice().sort(cmpDateThenTimeAsc);
      }
      
      // Apply customer filter if specified
      const customerFilter = opts.customerFilter || 'ALL';
      if (customerFilter !== 'ALL') {
        list = list.filter(d => {
          const group = normalizeCustomerGroup(d.customer);
          return group === customerFilter;
        });
        
        // Update title to reflect filter
        const filterLabels = {
          'JC': 'JC (all variants)',
          'KWL': 'KWL (all variants)'
        };
        title = title + " - " + filterLabels[customerFilter];
      }
      
      // Calculate summary totals
      const calculateTotals = (dataList) => {
        let jcTotal = 0;
        let jcCount = 0;
        let kwlTotal = 0;
        let kwlCount = 0;
        
        dataList.forEach(d => {
          const group = normalizeCustomerGroup(d.customer);
          const hours = parseFloat(d.manHours) || 0;
          
          if (hours > 0) {
            if (group === "JC") {
              jcTotal += hours;
              jcCount++;
            }
            if (group === "KWL") {
              kwlTotal += hours;
              kwlCount++;
            }
          }
        });
        
        return {
          jc: { total: jcTotal.toFixed(1), count: jcCount },
          kwl: { total: kwlTotal.toFixed(1), count: kwlCount }
        };
      };
      
      const totals = calculateTotals(list);
      
      // Store print data in localStorage
      const printData = {
        title: title,
        deliveries: list,
        totals: totals,
        includeHoursColumn: opts.includeHoursColumn !== false // default to true if not specified
      };
      
      localStorage.setItem('wilson-print-list-data', JSON.stringify(printData));
      
      // Open dedicated print list template in new window
      const printWindow = window.open('print-list.html', '_blank');
      
      if (!printWindow) {
        alert('Popup blocked! Please allow popups for this site, then try again.');
        localStorage.removeItem('wilson-print-list-data');
      }
      
    } catch (err) {
      console.error('[Print List] Error:', err);
      alert('Error opening print preview. Please try again.');
    }
  }

  return (
    <div className="app">
      <header className="bar topbar">
        <div className="brand">
          <div className="logo"><img src="./img/wi-logo.svg" alt="Wilson Interiors" /></div>
          <div className="brand-text">
            <h1 className="title">{isDeliveryDashboard() ? 'DELIVERY DASHBOARD' : 'OPERATIONS HUB'}</h1>
          </div>
        </div>

        {isOperationsDashboard() && (
          <div className="top-controls" role="group" aria-label="Top controls">
          <button
            className="btn-search"
            onClick={function(){setShowSearch(true);}}
            title="Search by postcode"
            aria-label="Search by postcode"
          >
            <i className="fa-solid fa-search"></i>
          </button>

          <span className="v-divider" aria-hidden="true"></span>

          <div className="filters" role="group" aria-label="Delivery filters">
            <div className="filter">
              <span className="label">Customer</span>
              <label className="select" title="Filter by customer">
                <select
                  aria-label="Filter by customer"
                  value={customerFilter}
                  onChange={function(e){setCustomerFilter(e.target.value);}}
                >
                  <option value="ALL">All</option>
                  {customerOptions.map(function(c){return <option key={c} value={c}>{c}</option>;})}
                </select>
              </label>
            </div>

            <div className="filter">
              <span className="label">Carrier</span>
              <label className="select" title="Filter by carrier">
                <select
                  aria-label="Filter by carrier"
                  value={carrierFilter}
                  onChange={function(e){setCarrierFilter(e.target.value);}}
                >
                  <option value="ALL">All</option>
                  {carrierOptions.map(function(c){return <option key={c} value={c}>{c}</option>;})}
                </select>
              </label>
            </div>

            <button
              className="btn btn-reset"
              onClick={function(){setCustomerFilter('ALL'); setCarrierFilter('ALL');}}
              title="Reset filters"
              aria-label="Reset filters"
            >
              Reset
            </button>
          </div>
        </div>
        )}

        {isDeliveryDashboard() && (
          <div className="top-controls" role="group" aria-label="Top controls">
            <button
              className="btn-search"
              onClick={function(){setShowSearch(true);}}
              title="Search by postcode"
              aria-label="Search by postcode"
            >
              <i className="fa-solid fa-search"></i>
            </button>
          </div>
        )}
      </header>

      <main id="app-main" className="container">
        <Section title="Today's Deliveries" subtitle={new Intl.DateTimeFormat(undefined,{weekday:"long",day:"2-digit",month:"long",year:"numeric"}).format(today)}>
          {loading ? <div className="status">Loading latest data...</div> : null}
          {(!loading && error) ? (
            <div className="status error">
              <div>Could not load data.</div>
              <small>{error}</small>
            </div>
          ) : null}
          {(!loading && !error && todaysDeliveries.length===0) ? (
            <div className="status">No deliveries scheduled for today.</div>
          ) : null}

          <div className="section-desktop">
            {(!manyToday) ? (
              <EqualGrid className="grid today-grid" depKey={String(todaysDeliveries.length)+"-"+String(lastUpdated ? lastUpdated.getTime() : 0)}>
                {todaysDeliveries.map(function(item,idx){
                  return (
                    <DeliveryCard
                      key={idx}
                      delivery={item}
                      onOpen={setOpenDelivery}
                      onPrintNote={openNotePrint}
                      showCarrierIcon={true}
                      showCarrierRow={false}
                    />
                  );
                })}
              </EqualGrid>
            ) : (
              <TVList items={todaysDeliveries} onOpen={setOpenDelivery}/>
            )}
          </div>

          <div className="section-mobile">
            {(todaysDeliveries.length>0) ? (
              <MobileList items={todaysDeliveries} onOpen={setOpenDelivery}/>
            ) : null}
          </div>
        </Section>

        <Section title={tomorrowSectionTitle} subtitle={tomorrowSectionSubtitle}>
          {(!loading && !error && (!targetTomorrowDate || tomorrowsDeliveries.length===0)) ? (
            <div className="status">No upcoming deliveries found.</div>
          ) : null}

          <div className="section-desktop">
            {(!!targetTomorrowDate) ? (
              (!manyTomorrow ? (
                <EqualGrid className="grid tomorrow-grid" depKey={String(tomorrowsDeliveries.length)+"-"+String(lastUpdated ? lastUpdated.getTime() : 0)}>
                  {tomorrowsDeliveries.map(function(item,idx){
                    return (
                      <DeliveryCard
                        key={idx}
                        delivery={item}
                        onOpen={setOpenDelivery}
                        onPrintNote={openNotePrint}
                        showCarrierIcon={true}
                        showCarrierRow={false}
                      />
                    );
                  })}
                </EqualGrid>
              ) : (
                <TVList items={tomorrowsDeliveries} onOpen={setOpenDelivery}/>
              ))
            ) : null}
          </div>

          <div className="section-mobile">
            {(!!targetTomorrowDate && tomorrowsDeliveries.length>0) ? (
              <MobileList items={tomorrowsDeliveries} onOpen={setOpenDelivery}/>
            ) : null}
          </div>
        </Section>

        <Section
          title={computedWeek.title}
          subtitle={computedWeek.subtitle}
          right={
            <div className="week-controls" aria-label="Change week">
              <button className="btn prev" onClick={function(){setWeekOffset(function(n){return n-1;});}} aria-label="Previous week"><i className="fa-solid fa-arrow-left"></i> Prev</button>
              <button className="btn ghost thisweek" onClick={function(){setWeekOffset(0);}} disabled={weekOffset===0} aria-label="This week">This Week</button>
              <button className="btn next" onClick={function(){setWeekOffset(function(n){return n+1;});}} aria-label="Next week">Next <i className="fa-solid fa-arrow-right"></i></button>
            </div>
          }
        >
          {loading ? <div className="status">Loading weekly data...</div> : null}
          {(!loading && error) ? (
            <div className="status error">
              <div>Could not load data.</div>
              <small>{error}</small>
            </div>
          ) : null}
          {(!loading && !error && (computedWeek.items||[]).length===0) ? (
            <div className="status">No scheduled deliveries for the selected period.</div>
          ) : null}

          <div className="section-desktop">
            {(computedWeek.items||[]).length>0 ? (
              <TVListWeek items={computedWeek.items} onOpen={setOpenDelivery}/>
            ) : null}
          </div>

          <div className="section-mobile">
            {(computedWeek.items||[]).length>0 ? (
              <MobileList items={computedWeek.items} onOpen={setOpenDelivery}/>
            ) : null}
          </div>
        </Section>

        <Section title="Yesterday's Deliveries" subtitle="Completed yesterday" extraClass="hide-mobile">
          {(!loading && !error && yesterdayDeliveries.length===0) ? (
            <div className="status">No deliveries yesterday.</div>
          ) : null}

          <div className="section-desktop">
            <EqualGrid className="grid week-grid" depKey={String(yesterdayDeliveries.length)+"-"+String(lastUpdated ? lastUpdated.getTime() : 0)}>
              {yesterdayDeliveries.map(function(item,idx){
                return (
                  <DeliveryCard
                    key={idx}
                    delivery={item}
                    onOpen={setOpenDelivery}
                    onPrintNote={openNotePrint}
                    delivered={true}
                    showDeliveredPill={false}
                    showCarrierIcon={true}
                    showCarrierRow={false}
                  />
                );
              })}
            </EqualGrid>
          </div>
        </Section>

        {/* Hidden print content controlled by state */}
        {isOperationsDashboard() && (
          <PrintArea mode={printMode} weekStart={computedWeek.start} monthDate={printMonthDate} data={data} />
        )}
      </main>

      <footer className="footer">
        <div className="right" style={{justifyContent:'flex-start'}}>
          {lastUpdated ? (
            <span title={lastUpdated.toLocaleString()}>
              Updated {FMT_UPDATED.format(lastUpdated)}
            </span>
          ) : null}
          <span aria-hidden="true">&nbsp;•&nbsp;</span>
          <span>Auto-refreshes every 5 minutes</span>
          <span aria-hidden="true">&nbsp;•&nbsp;</span>
          <span className="version-text">v2.2.0</span>
        </div>
        <div className="right">
          <button className="btn" onClick={function(e){e.preventDefault(); refetch();}} aria-label="Refresh data" title="Refresh">Refresh</button>
          {isOperationsDashboard() && (
            <button className="btn primary print-btn" onClick={function(){setShowPrint(true);}} title="Print">Print</button>
          )}
          <button className="btn ghost" onClick={function(){window.scrollTo({top:0,behavior:'smooth'});}} title="Scroll to top"><i className="fa-solid fa-arrow-up"></i> Top</button>
        </div>
      </footer>

      {/* Print options modal wiring */}
      {isOperationsDashboard() && (
        <PrintOptions
          open={showPrint}
          onClose={function(){setShowPrint(false);}}
          onConfirm={openListPrint}
          defaultMonthStr={defaultMonthStr}
          defaultWeekStartStr={defaultWeekStartStr}
        />
      )}

      {openDelivery ? (
        <DeliveryModal
          delivery={openDelivery}
          onClose={function(){setOpenDelivery(null);}}
          onPrintNote={function(d){openNotePrint(d);}}
        />
      ) : null}

      {/* Search modal wiring */}
      <SearchModal
        open={showSearch}
        onClose={function(){setShowSearch(false);}}
        data={data}
        onPick={function(d){ setShowSearch(false); setOpenDelivery(d); }}
      />
    </div>
  );
}

try{
  const rootEl = document.getElementById("root");
  if(!rootEl) throw new Error("Root element not found");
  const root=ReactDOM.createRoot(rootEl);
  root.render(<App/>);
}catch(err){
  const panel = document.getElementById('boot-error');
  const text = document.getElementById('boot-error-text');
  if(panel && text){
    text.textContent = (err && err.stack) ? err.stack : String(err);
    panel.style.display='flex';
  }
  console.error(err);
}