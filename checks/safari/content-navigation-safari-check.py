#!/usr/bin/env python3
"""Exercise the real navigation helpers in Safari over a large synthetic outline.

No school requests or extension installation. The temporary tab is closed in finally.
"""
import json
import pathlib
import subprocess
import tempfile
import time

ROOT = pathlib.Path(__file__).resolve().parents[1]


def apple(source):
    return subprocess.check_output(["osascript", "-e", source], text=True, timeout=30).strip()


def part(source, start, end):
    begin = source.index(start)
    return source[begin:source.index(end, begin)]


with tempfile.TemporaryDirectory(prefix="glaze-nav-safari-") as directory:
    file = pathlib.Path(directory) / "navigation.html"
    url = file.as_uri()
    ctabs = (ROOT / "features/coursetabs.js").read_text()
    palette = (ROOT / "features/palette.js").read_text()
    bar = part(ctabs, "  const bar = {", "  return { sync")
    open_at = part(ctabs, "  const openAt = ", "  // A page outside a course:")
    go = part(palette, "  const go = (url)", "  // Ultra's Institution")
    imports = "".join('<script>' + (ROOT / p).read_text().replace('</script', '<\\/script') + '</script>' for p in
                      ["lib/color.js", "lib/i18n.js", "lib/page.js", "lib/fonts.js", "lib/surfaces.js", "defaults.js", "lib/coursetabs.js", "lib/ultra.js"])
    script = """
    const rows = document.getElementById('outline');
    for (let f=0; f<100; f++) {
      const folder=document.createElement('section'); folder.className='content-list-item';
      folder.dataset.contentId=`_${f+10}_1`;
      folder.innerHTML=`<button aria-expanded="true">Folder ${f+1}</button>`;
      for(let i=0;i<20;i++) {
        const row=document.createElement('article');row.className='content-list-item';
        row.innerHTML=`<h3>Reading ${f*20+i+1}</h3><p>Large synthetic course content</p><a href="#">Open</a>`;
        folder.append(row);
      }
      rows.append(folder);
    }
    const calls=[];let placeEnabled=false;
    const ctx={site:'ultra',courseId:()=> '_101_1',on:()=>true,settings:()=>({enhance:{place:placeEnabled}})};
    const location={origin:'https://bb.school.test',assign:u=>calls.push(['native',u])};
    const L=GZ_CTABS_LIB, on=true, framed='', showing='_101_1';
    const frame={dirty:false,el:{contentWindow:{location:{assign:u=>calls.push(['frame',u])}}}};
    const frames=new Map([['_101_1',frame]]),tabs=[{cid:'_101_1',name:'Course'}];
    const load=(cid,f,u)=>{calls.push(['load',cid,u]);return true;};
    const stamp=()=>{},save=()=>{},reveal=()=>{},t=s=>s,labelFor=()=> 'Course',say=()=>calls.push(['preserved']);
    const route=u=>calls.push(['history',u]),show=()=>{};
    OPEN_AT
    BAR
    globalThis.GZ_CTABS={bar};
    globalThis.GZ_CTX=ctx;
    GO
    const canonical='/ultra/redirect?redirectType=nautilus&courseId=_101_1&contentId=_900_1&parentId=_800_1';
    const item={id:'_999_1',contentHandler:{id:'resource/x-bb-courselink'},links:[
      {rel:'self',href:'/learn/api/public/v1/courses/_101_1/contents/_999_1'},
      {rel:'alternate',href:canonical}]};
    document.getElementById('select').onclick=()=>{
      try {
      const start=performance.now();
      for(const enabled of [false,true]) {placeEnabled=enabled;go(GZ_ULTRA.contentLink(item,'_101_1',location.origin))();}
      frame.dirty=true;go(GZ_ULTRA.contentLink(item,'_101_1',location.origin))();
      window.__result={rows:document.querySelectorAll('.content-list-item').length,
        nodes:document.querySelectorAll('*').length,calls,selectionMs:performance.now()-start};
      } catch(e) { window.__result={error:String(e),stack:e.stack}; }
    };
    """.replace("OPEN_AT", open_at).replace("BAR", bar).replace("GO", go)
    # The test deliberately includes the production legacy-injection guard as well.
    guard = (ROOT / "features/place.js").read_text()
    file.write_text('<!doctype html><meta charset="utf-8"><title>Glaze navigation check</title>'
                    '<p role="status">AI agent is controlling this tab</p>'
                    '<button id="select">Open selected result</button><div id="outline"></div>'
                    + imports + '<script>(()=>{' + script + '\n' + guard
                    + '\nglobalThis.GZ_PLACE=GZ_PLACE;GZ_PLACE.sync();window.__ready=true;})();</script>')
    created = False
    try:
        apple('tell application "Safari"\nmake new tab at end of tabs of front window with properties {URL:'
              + json.dumps(url) + '}\nend tell')
        created = True

        def js(expression):
            return apple('tell application "Safari"\nrepeat with w in windows\nrepeat with t in tabs of w\n'
                         'if URL of t is ' + json.dumps(url) + ' then return do JavaScript '
                         + json.dumps(expression) + ' in t\nend repeat\nend repeat\nerror "Test tab missing"\nend tell')

        for _ in range(40):
            if js('String(window.__ready === true)') == 'true':
                break
            time.sleep(0.25)
        else:
            raise RuntimeError('Safari fixture did not initialize')
        js('document.getElementById("select").click(); "selected"')
        result = json.loads(js('JSON.stringify(window.__result)'))
        assert result.get('rows') == 2100, result
        destination = '/ultra/redirect?redirectType=nautilus&courseId=_101_1&contentId=_900_1&parentId=_800_1'
        assert result['calls'] == [['load', '_101_1', destination], ['load', '_101_1', destination], ['preserved']], result
        print(json.dumps(result))
    finally:
        if created:
            # The tab is task-owned; closing it also removes the indicator and all fixture helpers.
            apple('tell application "Safari"\nrepeat with w in windows\nrepeat with i from (count of tabs of w) to 1 by -1\n'
                  'if URL of tab i of w is ' + json.dumps(url) + ' then close tab i of w\nend repeat\nend repeat\nend tell')
