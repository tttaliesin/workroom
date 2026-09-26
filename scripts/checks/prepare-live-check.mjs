import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Workroom } from '../../src/core/service.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const manifestFile=path.join(root,'work/live-check-session.json');
const visible=JSON.parse(fs.readFileSync(path.join(root,'work/visible-runtime-session.json'),'utf8').replace(/^\uFEFF/,''));
if(fs.existsSync(manifestFile)) {
  const existing=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
  if(existing.dataDirectory===visible.dataDirectory) { console.log(JSON.stringify(existing));process.exit(0); }
}
const directory=fs.mkdtempSync(path.join(root,'work/live-model-fixture-'));
fs.writeFileSync(path.join(directory,'README.md'),`# 모델 연결 검증용 예제\n\n실제 사용자 제품과 구분한 최소 소스입니다.\n\nnormalizeLabel은 문자열 앞뒤 공백을 제거합니다. 공백만 있거나 문자열이 아니면 "이름 없음"을 반환합니다. 문자열 내부 공백은 유지합니다.\n\n이 예제의 목적은 모델의 파일 읽기, 독립 근거 검토, 조건부 기록 저장을 확인하는 것입니다. 읽기 전용 조사이며 실행이나 수정 성공을 주장하지 않습니다.\n`);
fs.writeFileSync(path.join(directory,'label.mjs'),`export function normalizeLabel(value) {\n  if (typeof value !== 'string') return '이름 없음';\n  return value.trim() || '이름 없음';\n}\n`);
const room=new Workroom(path.join(visible.dataDirectory,'workroom.sqlite'));
let product;
try { product=await room.createProduct({name:'실제 모델 연결 검증',folder:directory,goal:'작은 예제의 조사 → 근거 확인 → 기록 저장을 실제 모델로 검증'}); }
finally {room.close();}
const manifest={dataDirectory:visible.dataDirectory,directory,productId:product.id,productName:product.name,goal:'README.md와 label.mjs만 읽고 normalizeLabel의 빈 값 처리와 앞뒤 공백 제거 동작을 소스 근거로 확인해 주세요. 내부 공백이 유지되는지도 확인하세요. 조사와 별도 근거 확인을 거쳐 이 예제에서 재사용할 조건부 사실을 최대 1개 기록하세요. 코드를 수정하거나 테스트를 실행하지 말고, 소스 확인의 한계를 명시하세요.',preparedAt:new Date().toISOString()};
fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2));
console.log(JSON.stringify(manifest));
