const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../zhinst_csv_scrapper.html'),'utf8');
const script=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).find(s=>s.includes('function scanLabels'));
function harness(){
  const nodes=new Map(),charts=[],blobs=[],downloads=[];
  function node(id){
    if(!nodes.has(id))nodes.set(id,{value:'',checked:false,disabled:true,style:{},children:[],
      classList:{add(){},remove(){}},addEventListener(){},getContext:()=>({}),appendChild(child){this.children.push(child);}});
    return nodes.get(id);
  }
  node('delimiterSelect').value='auto';
  const ctx=vm.createContext({document:{getElementById:node,createElement:()=>({style:{},click(){downloads.push(this);}}),body:{appendChild(){},removeChild(){}}},
    Chart:class{constructor(context,config){this.config=config;this.destroyed=false;charts.push(this);}destroy(){this.destroyed=true;}},
    Blob,URL:{createObjectURL:blob=>{blobs.push(blob);return 'blob:test';}}});
  vm.runInContext(script,ctx);
  return {ctx,node,charts,blobs,downloads,read:code=>vm.runInContext(code,ctx),
    load(text,delimiter='auto'){
      ctx.testText=text;node('delimiterSelect').value=delimiter;
      vm.runInContext('rawText=testText;rawFile={name:"measurements.csv"};scanLabels();',ctx);
      node('selFreq').value='freq';node('selR').value='r';node('selP').value='phase';ctx.extractData();
    },data(){return JSON.parse(vm.runInContext('JSON.stringify(parsedData)',ctx));},
    logs(){return node('logPanel').children.map(n=>n.textContent).join('\n');}};
}
function row(label,values,sep=';'){return ['device','0','0',label,...values].join(sep);}
function fixture(f=[1,2,3],r=[10,20,30],p=[100,200,300],sep=';'){
  return [row('freq',f,sep),row('r',r,sep),row('phase',p,sep)].join('\n');
}
const complete=[{f:1,r:10,p:100},{f:2,r:20,p:200},{f:3,r:30,p:300}];
test('issue 12: blank lines retain original row indices during scanning and extraction',()=>{
  const text='\n\n'+row('freq',[1,2,3])+'\n\n'+row('r',[10,20,30])+'\n  \n'+row('phase',[100,200,300])+'\n';
  const h=harness();h.load(text);
  assert.deepEqual(h.data(),complete);
  assert.equal(h.read('labelMap.get("freq").rows[0]'),2);
  assert.equal(h.read('labelMap.get("r").rows[0]'),4);
  assert.equal(h.read('labelMap.get("phase").rows[0]'),6);
});
test('leading blank lines do not consume the label-detection window and CRLF is supported',()=>{
  const h=harness();h.load(('\n'.repeat(25)+fixture()).replace(/\n/g,'\r\n'));
  assert.deepEqual(h.data(),complete);
});
test('issue 13: a missing value in any channel excludes its whole sample without shifting later pairs',()=>{
  for(const channel of [0,1,2])for(const position of [0,1,2]){
    const values=[[1,2,3],[10,20,30],[100,200,300]];values[channel][position]='';
    const h=harness();h.load(fixture(...values));
    assert.deepEqual(h.data(),complete.filter((_,i)=>i!==position));
    assert.match(h.node('statusMsg').textContent,/1 incomplete samples excluded/);
  }
});
test('non-finite, malformed and missing cells preserve their positions instead of becoming values',()=>{
  for(const invalid of ['NaN','Infinity','-Infinity','2junk','1e999',' ']){
    const h=harness();h.load(fixture([1,2,3],[10,invalid,30]));
    assert.deepEqual(h.data(),[complete[0],complete[2]]);
  }
});
test('missing cells at different positions are combined across channels before exclusion',()=>{
  const h=harness();h.load(fixture([1,'',3],[10,20,''],[100,200,300]));
  assert.deepEqual(h.data(),[complete[0]]);assert.match(h.logs(),/2 incomplete samples excluded/);
});
test('unequal channel widths are rejected instead of silently truncating',()=>{
  const h=harness();h.load(fixture([1,2,3],[10,20],[100,200,300]));
  assert.deepEqual(h.data(),[]);assert.equal(h.node('downloadBtn').disabled,true);
  assert.match(h.node('statusMsg').textContent,/sample counts differ/);
  h.ctx.download();assert.equal(h.downloads.length,0);
});
test('repeated label rows preserve row-group positions and blank lines',()=>{
  const h=harness();h.load(fixture([1,2],[10,20],[100,200])+'\n\n'+fixture([3,4],[30,''],[300,400]));
  assert.deepEqual(h.data(),complete);assert.match(h.logs(),/1 incomplete samples excluded/);
});
test('equal flattened lengths cannot hide incompatible row groups',()=>{
  const text=[row('freq',[1,2]),row('r',[10]),row('phase',[100,200]),
    row('freq',[3]),row('r',[20,30]),row('phase',[300])].join('\n');
  const h=harness();h.load(text);assert.deepEqual(h.data(),[]);
  assert.match(h.node('statusMsg').textContent,/sample counts differ in row group 1/);
});
test('a missing channel row is rejected even when total sample counts are equal',()=>{
  const h=harness();h.load(fixture([1],[10,20],[100])+'\n'+row('freq',[2])+'\n'+row('phase',[200]));
  assert.deepEqual(h.data(),[]);assert.match(h.node('statusMsg').textContent,/different row counts/);
});
test('semicolon, comma and tab delimiters work in automatic and explicit modes',()=>{
  for(const [sep,mode] of [[';',';'],[',',','],['\t','tab']])for(const delimiter of ['auto',mode]){
    const h=harness();h.load('\n'+fixture(undefined,undefined,undefined,sep),delimiter);
    assert.deepEqual(h.data(),complete);
  }
});
test('decimal commas, scientific notation, zero and signed values remain valid',()=>{
  const h=harness();h.load(fixture(['3','0','-1'],['3,5','+0e0','-2.5e1'],['30','0','-100']));
  assert.deepEqual(h.data(),[{f:-1,r:-25,p:-100},{f:0,r:0,p:0},{f:3,r:3.5,p:30}]);
  assert.equal(h.read('labelMap.get("r").sampleCount'),3);
});
test('failed re-extraction clears the old chart, table and downloadable data',()=>{
  const h=harness();h.load(fixture());const chart=h.charts.at(-1);
  h.load(fixture([1,2,3],[10],[100,200,300]));
  assert(chart.destroyed);assert.equal(h.node('previewBody').innerHTML,'');
  assert.equal(h.node('rowCountBadge').textContent,'0 pts');
  assert.equal(h.node('downloadBtn').disabled,true);h.ctx.download();assert.equal(h.downloads.length,0);
});
test('incomplete selection or a rescan without selected labels disables stale exports',()=>{
  const h=harness();h.load(fixture());h.node('selP').value='';h.ctx.extractData();
  assert.deepEqual(h.data(),[]);assert.equal(h.node('downloadBtn').disabled,true);
  h.load(fixture());h.ctx.testText='';h.read('rawText=testText;scanLabels();');
  assert.deepEqual(h.data(),[]);assert.equal(h.node('downloadBtn').disabled,true);
});
test('no complete samples leaves a visible error and no downloadable data',()=>{
  const h=harness();h.load(fixture(['',''],[10,20],[100,200]));
  assert.deepEqual(h.data(),[]);assert.match(h.node('statusMsg').textContent,/No complete numeric samples/);
  assert.equal(h.node('downloadBtn').disabled,true);
});
test('TSV and CSV downloads contain only correctly aligned, sorted tuples',async()=>{
  const h=harness();h.load(fixture([3,1,2],[30,'',20],[300,100,200]));
  for(const comma of [false,true]){
    h.node('chkComma').checked=comma;h.ctx.download();
    const sep=comma?',':'\t',content=await h.blobs.at(-1).text();
    assert.equal(content,[['freq','r','phase'],[2,20,200],[3,30,300]].map(row=>row.join(sep)).join('\n')+'\n');
    assert.equal(h.downloads.at(-1).download,'measurements_extracted'+(comma?'.csv':'.tsv'));
  }
});
test('page JavaScript parses and release identifiers agree',()=>{
  new vm.Script(script);assert.equal(require('../package.json').version,'1.0.1');
  assert.match(html,/<title>.*v1\.0\.1/);assert(html.includes('v1.0.1, 12 November 2026'));
});
