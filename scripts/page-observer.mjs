function clean(value, max = 300) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export async function observePage(page, generation) {
  const raw = await page.evaluate(() => {
    const selector = ['button','summary','input','textarea','select','a[href]','[role="button"]','[role="link"]','[role="textbox"]','[role="checkbox"]','[role="radio"]','[role="combobox"]','[contenteditable="true"]'].join(',');
    const nodes=[...document.querySelectorAll(selector)]; const seen=new Set(); const elements=[];
    for (const el of nodes) {
      if(seen.has(el)) continue; seen.add(el);
      const r=el.getBoundingClientRect(); const cs=getComputedStyle(el);
      if(!(r.width>0&&r.height>0&&cs.display!=='none'&&cs.visibility!=='hidden')) continue;
      const tag=el.tagName.toLowerCase();
      const role=el.getAttribute('role')||({button:'button',summary:'button',a:'link',textarea:'textbox',select:'combobox'}[tag]??(tag==='input'?(el.type==='checkbox'?'checkbox':el.type==='radio'?'radio':'textbox'):null));
      const label=el.getAttribute('aria-label')||el.getAttribute('placeholder')||el.getAttribute('title')||'';
      elements.push({domIndex:nodes.indexOf(el),tag,role,label,text:(el.innerText||el.textContent||'').trim(),type:el.getAttribute('type'),name:el.getAttribute('name'),value:'value' in el?String(el.value??''):null,disabled:'disabled' in el?Boolean(el.disabled):false,editable:tag==='textarea'||tag==='input'||el.isContentEditable,x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)});
    }
    return {url:location.href,title:document.title,text:(document.body?.innerText||'').slice(0,12000),elements};
  });
  const elements=raw.elements.map((el,i)=>({id:`g${generation}-e${i+1}`,domIndex:el.domIndex,role:el.role,label:clean(el.label),text:clean(el.text),type:el.type,name:el.name,value:clean(el.value,1000),disabled:el.disabled,editable:el.editable,bounds:{x:el.x,y:el.y,width:el.width,height:el.height}}));
  return {generation,url:raw.url,title:raw.title,pageText:clean(raw.text,12000),elements};
}
