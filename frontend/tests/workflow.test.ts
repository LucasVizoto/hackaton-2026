import assert from 'node:assert/strict';
import test from 'node:test';
import { allowed, csvCell, invoiceNumber, quantity, revalidatedTime, uploadIdentity } from '../src/app/core/workflow';

test('NF retains all valid digits and rejects lossy or ambiguous identifiers', () => {
  for (const value of ['1','123456789']) assert.equal(invoiceNumber(value),value);
  for (const value of ['0','01','1234567890','123abc','1.2','1,2','1e4','+12','-2','１２３','']) assert.throws(()=>invoiceNumber(value));
});
test('quantities preserve decimals without substituting zero for missing data', () => {
  assert.equal(quantity('2378,1234'),'2378.1234');
  assert.equal(quantity('9007199254740993.000001',6),'9007199254740993.000001');
  assert.equal(quantity('0'),'0');
  for(const value of ['',null,undefined,'-1','1e3','1.234,5','1.23456'])assert.throws(()=>quantity(value));
});
test('a cached upload belongs to both its file and its metadata', () => {
  const file={name:'nota.pdf',size:41,lastModified:123};
  const initial=uploadIdentity(file,'supplier-a','123');
  assert.equal(initial,uploadIdentity({...file},'supplier-a','123'));
  assert.notEqual(initial,uploadIdentity(file,'supplier-b','123'));
  assert.notEqual(initial,uploadIdentity(file,'supplier-a','124'));
  assert.notEqual(initial,uploadIdentity({...file,lastModified:124},'supplier-a','123'));
});
test('slot revalidation retains only the explicit selection still authorized by the server', () => {
  const slots=[{time:'08:00',eligible:false,reason:'Carga exclusiva'},{time:'10:00:00',eligible:true,reason:''}];
  assert.equal(revalidatedTime('08:00',slots),'');
  assert.equal(revalidatedTime('10:00',slots),'10:00');
  assert.equal(revalidatedTime('',slots),'');
  assert.equal(revalidatedTime('10:00',[]),'');
});
test('actions fail closed when their server permission is missing or denied', () => {
  assert.equal(allowed(undefined,'gate-check-out'),false);
  assert.equal(allowed([{code:'gate-check-out',allowed:false,reason:'Sem entrada'}],'gate-check-out'),false);
  assert.equal(allowed([{code:'gate-check-out',allowed:true,reason:''}],'gate-check-out'),true);
});
test('CSV quotes fields and prevents spreadsheet formulas from document names', () => {
  assert.equal(csvCell('Fornecedor "A"'),'"Fornecedor ""A"""');
  for (const value of ['=1+1','+SUM(A1)','-1+2','@command','\tformula','\rformula']) assert.ok(csvCell(value).startsWith('"\''));
  assert.equal(csvCell(null),'""');
});
