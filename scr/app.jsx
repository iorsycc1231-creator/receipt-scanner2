import { useState, useRef, useCallback } from 'react'

const PROMPT = `このレシート・領収書の画像を解析して、以下のJSON形式のみで返してください。説明文・マークダウン・コードブロックは一切不要です。JSONオブジェクトだけを返してください。

{
  "store_name": "店名（不明なら空文字）",
  "invoice_number": "インボイス登録番号（T始まり13桁、なければ空文字）",
  "date": "日付（YYYY-MM-DD形式、不明なら空文字）",
  "items": [
    {
      "name": "商品名・サービス名",
      "amount": 金額数値,
      "tax_category": "10%標準" または "8%軽減" または "非課税" または "不明"
    }
  ],
  "subtotal": 小計数値またはnull,
  "tax_8": 消費税8%額数値またはnull,
  "tax_10": 消費税10%額数値またはnull,
  "total": 合計金額数値またはnull,
  "notes": "特記事項"
}`

async function callGemini(apiKey, base64Image, mimeType) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [
        { inline_data: { mime_type: mimeType, data: base64Image } },
        { text: PROMPT }
      ]}],
      generationConfig: { temperature: 0.1, maxOutputTokens: 1500 }
    })
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`Gemini APIエラー: ${err?.error?.message || res.status}`)
  }
  const data = await res.json()
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
  return parseJson(raw)
}

function parseJson(raw) {
  if (!raw) throw new Error('AIからの応答が空でした')
  let text = raw.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```\s*$/,'').trim()
  const s = text.indexOf('{'), e = text.lastIndexOf('}')
  if (s===-1||e===-1) throw new Error(`JSONが見つかりません\n${text.slice(0,200)}`)
  try { return JSON.parse(text.slice(s,e+1)) }
  catch(err) { throw new Error(`JSONパースエラー: ${err.message}`) }
}

function toCSV(receipts) {
  const h = ['No','店名','インボイス番号','日付','商品名','金額','税区分','小計','消費税(8%)','消費税(10%)','合計金額','備考']
  const esc = v => { const s=String(v??''); return /[,"\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s }
  const rows = []
  receipts.forEach((r,i) => {
    const items = r.items?.length ? r.items : [{name:'',amount:'',tax_category:''}]
    items.forEach((item,j) => rows.push([
      j===0?i+1:'', j===0?r.store_name||'':'', j===0?r.invoice_number||'':'',
      j===0?r.date||'':'', item.name||'', item.amount??'', item.tax_category||'',
      j===0?r.subtotal??'':'', j===0?r.tax_8??'':'', j===0?r.tax_10??'':'',
      j===0?r.total??'':'', j===0?r.notes||'':''
    ]))
  })
  return [h,...rows].map(r=>r.map(esc).join(',')).join('\n')
}

export default function App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('gemini_key')||'')
  const [showKey, setShowKey] = useState(false)
  const [receipts, setReceipts] = useState([])
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef()

  const saveKey = k => { setApiKey(k); localStorage.setItem('gemini_key',k) }

  const process = useCallback(async (file) => {
    if (!file.type.startsWith('image/')) return
    const id = Date.now()+Math.random()
    const preview = URL.createObjectURL(file)
    setReceipts(p=>[...p,{id,preview,status:'loading',data:null,error:null}])
    try {
      if (!apiKey.trim()) throw new Error('APIキーが入力されていません')
      const b64 = await new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result.split(',')[1]); r.onerror=()=>rej(new Error('読込失敗')); r.readAsDataURL(file) })
      const data = await callGemini(apiKey.trim(),b64,file.type)
      setReceipts(p=>p.map(r=>r.id===id?{...r,status:'done',data}:r))
    } catch(err) {
      setReceipts(p=>p.map(r=>r.id===id?{...r,status:'error',error:err.message}:r))
    }
  },[apiKey])

  const handleFiles = files => [...files].forEach(process)

  const downloadCSV = () => {
    const done = receipts.filter(r=>r.status==='done'&&r.data).map(r=>r.data)
    if (!done.length) return
    const blob = new Blob(['\uFEFF'+toCSV(done)],{type:'text/csv;charset=utf-8;'})
    Object.assign(document.createElement('a'),{href:URL.createObjectURL(blob),download:`経費精算_${new Date().toISOString().slice(0,10)}.csv`}).click()
  }

  const doneCount = receipts.filter(r=>r.status==='done').length
  const errCount  = receipts.filter(r=>r.status==='error').length
  const loadCount = receipts.filter(r=>r.status==='loading').length

  return (
    <div style={{minHeight:'100vh',background:'#f5f3ee',fontFamily:"'Noto Sans JP',sans-serif"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;600;700&display=swap');*{box-sizing:border-box;margin:0;padding:0}@keyframes spin{to{transform:rotate(360deg)}}.spin{animation:spin .8s linear infinite}`}</style>
      <header style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'16px 20px',background:'#fffdf8',borderBottom:'2px solid #1c1917',position:'sticky',top:0,zIndex:10}}>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <div style={{width:38,height:38,background:'#1c1917',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,fontWeight:900,borderRadius:4}}>R</div>
          <div>
            <div style={{fontSize:17,fontWeight:700}}>Receipt Scan</div>
            <div style={{fontSize:11,color:'#78716c'}}>Gemini AI · 経費精算CSV</div>
          </div>
        </div>
        {doneCount>0&&<button onClick={downloadCSV} style={{background:'#16a34a',color:'#fff',border:'none',borderRadius:8,padding:'9px 16px',fontSize:13,fontWeight:600,cursor:'pointer'}}>⬇ CSV ({doneCount}件)</button>}
      </header>
      <div style={{maxWidth:960,margin:'0 auto',padding:'20px 16px 60px'}}>
        <div style={{background:'#fffdf8',border:'1px solid #e7e5e0',borderRadius:12,padding:'16px 18px',marginBottom:16}}>
          <div style={{fontSize:13,fontWeight:700,color:'#57534e',marginBottom:10}}>🔑 Gemini APIキー</div>
          <div style={{display:'flex',gap:8,marginBottom:8}}>
            <input type={showKey?'text':'password'} placeholder="AIza... で始まるキーを入力" value={apiKey} onChange={e=>saveKey(e.target.value)} style={{flex:1,background:'#f5f3ee',border:'1px solid #d6d3d1',borderRadius:8,padding:'10px 12px',fontSize:14,fontFamily:'monospace',outline:'none'}}/>
            <button onClick={()=>setShowKey(v=>!v)} style={{background:'none',border:'1px solid #d6d3d1',borderRadius:8,padding:'0 14px',cursor:'pointer',fontSize:16}}>{showKey?'🙈':'👁'}</button>
          </div>
          <div style={{fontSize:11,color:'#a8a29e'}}>キーはこのデバイスにのみ保存。取得先: <a href="https://aistudio.google.com" target="_blank" rel="noreferrer" style={{color:'#16a34a'}}>aistudio.google.com</a>（無料）</div>
        </div>
        <div style={{background:'#fffdf8',border:`2px dashed ${dragging?'#16a34a':'#d6d3d1'}`,borderRadius:12,padding:'40px 20px',textAlign:'center',cursor:'pointer',marginBottom:16}} onDragOver={e=>{e.preventDefault();setDragging(true)}} onDragLeave={()=>setDragging(false)} onDrop={e=>{e.preventDefault();setDragging(false);handleFiles(e.dataTransfer.files)}} onClick={()=>fileRef.current?.click()}>
          <input ref={fileRef} type="file" accept="image/*" multiple style={{display:'none'}} onChange={e=>handleFiles(e.target.files)}/>
          <div style={{fontSize:40,marginBottom:10}}>📷</div>
          <div style={{fontSize:16,fontWeight:700,marginBottom:6}}>レシートをドロップ・タップして選択</div>
          <div style={{fontSize:13,color:'#78716c'}}>JPG · PNG · HEIC · 複数枚同時OK</div>
        </div>
        {receipts.length>0&&(
          <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:16}}>
            <span style={{border:'1px solid #d6d3d1',borderRadius:20,padding:'4px 12px',fontSize:12}}>合計 {receipts.length}枚</span>
            {loadCount>0&&<span style={{border:'1px solid #d97706',color:'#d97706',borderRadius:20,padding:'4px 12px',fontSize:12}}>⏳ 解析中 {loadCount}</span>}
            {doneCount>0&&<span style={{border:'1px solid #16a34a',color:'#16a34a',borderRadius:20,padding:'4px 12px',fontSize:12}}>✓ 完了 {doneCount}</span>}
            {errCount>0&&<span style={{border:'1px solid #dc2626',color:'#dc2626',borderRadius:20,padding:'4px 12px',fontSize:12}}>✗ エラー {errCount}</span>}
          </div>
        )}
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:16}}>
          {receipts.map(r=><Card key={r.id} receipt={r} onRemove={()=>setReceipts(p=>p.filter(x=>x.id!==r.id))}/>)}
        </div>
      </div>
    </div>
  )
}

function Card({receipt,onRemove}) {
  const {preview,status,data,error} = receipt
  const [showErr,setShowErr] = useState(false)
  return (
    <div style={{background:'#fffdf8',border:'1px solid #e7e5e0',borderRadius:12,overflow:'hidden',boxShadow:'0 1px 4px rgba(0,0,0,.06)'}}>
      <div style={{position:'relative',height:180,background:'#e8e5de',overflow:'hidden'}}>
        <img src={preview} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/>
        <button onClick={onRemove} style={{position:'absolute',top:8,right:8,background:'rgba(0,0,0,.5)',color:'#fff',border:'none',borderRadius:'50%',width:28,height:28,cursor:'pointer',fontSize:13}}>✕</button>
        {status==='loading'&&<div style={{position:'absolute',inset:0,background:'rgba(245,243,238,.88)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:12}}>
          <div className="spin" style={{width:32,height:32,border:'3px solid #e7e5e0',borderTop:'3px solid #16a34a',borderRadius:'50%'}}/>
          <div style={{fontSize:13,color:'#57534e',fontWeight:600}}>Geminiが解析中…</div>
        </div>}
        {status==='done'&&<div style={{position:'absolute',bottom:8,left:8,background:'#16a34a',color:'#fff',fontSize:11,padding:'3px 10px',borderRadius:4,fontWeight:700}}>✓ 読取完了</div>}
        {status==='error'&&<div style={{position:'absolute',bottom:8,left:8,background:'#dc2626',color:'#fff',fontSize:11,padding:'3px 10px',borderRadius:4,fontWeight:700}}>✗ エラー</div>}
      </div>
      <div style={{padding:'14px 16px 16px'}}>
        {status==='loading'&&<p style={{color:'#a8a29e',fontSize:13,textAlign:'center'}}>解析中…</p>}
        {status==='error'&&<div style={{background:'#fef2f2',border:'1px solid #fca5a5',borderRadius:8,padding:'12px 14px'}}>
          <div style={{color:'#dc2626',fontWeight:700,fontSize:13,marginBottom:6}}>⚠ 解析に失敗しました</div>
          <button onClick={()=>setShowErr(v=>!v)} style={{background:'none',border:'none',color:'#dc2626',cursor:'pointer',fontSize:12,padding:0}}>{showErr?'詳細を隠す ▲':'詳細を見る ▼'}</button>
          {showErr&&<pre style={{fontSize:11,color:'#b91c1c',whiteSpace:'pre-wrap',wordBreak:'break-all',marginTop:8,background:'rgba(0,0,0,.04)',padding:10,borderRadius:6,maxHeight:160,overflowY:'auto'}}>{error}</pre>}
        </div>}
        {status==='done'&&data&&<>
          {[['店名',data.store_name],['日付',data.date],['インボイス',data.invoice_number||'—']].map(([l,v])=>(
            <div key={l} style={{display:'flex',justifyContent:'space-between',padding:'4px 0',gap:8}}>
              <span style={{fontSize:12,color:'#78716c'}}>{l}</span>
              <span style={{fontSize:13,textAlign:'right'}}>{v||'—'}</span>
            </div>
          ))}
          <hr style={{border:'none',borderTop:'1px solid #e7e5e0',margin:'8px 0'}}/>
          {data.items?.map((item,i)=>(
            <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'3px 0',gap:6}}>
              <span style={{fontSize:12,color:'#78716c',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.name||'—'}</span>
              <span style={{display:'flex',alignItems:'center',gap:6,flexShrink:0}}>
                <span style={{fontSize:10,background:'#f0fdf4',color:'#16a34a',border:'1px solid #bbf7d0',borderRadius:4,padding:'1px 6px'}}>{item.tax_category}</span>
                <span style={{fontSize:13}}>¥{Number(item.amount||0).toLocaleString()}</span>
              </span>
            </div>
          ))}
          <hr style={{border:'none',borderTop:'1px solid #e7e5e0',margin:'8px 0'}}/>
          {data.tax_8!=null&&<div style={{display:'flex',justifyContent:'space-between',padding:'4px 0'}}><span style={{fontSize:12,color:'#78716c'}}>消費税 8%</span><span style={{fontSize:13}}>¥{data.tax_8.toLocaleString()}</span></div>}
          {data.tax_10!=null&&<div style={{display:'flex',justifyContent:'space-between',padding:'4px 0'}}><span style={{fontSize:12,color:'#78716c'}}>消費税 10%</span><span style={{fontSize:13}}>¥{data.tax_10.toLocaleString()}</span></div>}
          <div style={{display:'flex',justifyContent:'space-between',padding:'4px 0'}}><span style={{fontSize:12,color:'#78716c'}}>合計</span><span style={{fontSize:15,fontWeight:800,color:'#16a34a'}}>{data.total!=null?`¥${data.total.toLocaleString()}`:'—'}</span></div>
          {data.notes&&<p style={{fontSize:11,color:'#a8a29e',marginTop:8,fontStyle:'italic'}}>{data.notes}</p>}
        </>}
      </div>
    </div>
  )
}
