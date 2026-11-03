import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSchoolDefinitions} from '../base/src/platform/school-definitions.mjs';
test('explicit schools preserve identity and reject ambiguous or unsafe deployment inputs',()=>{
  const school={schoolId:'uw',spaceId:'uw-seattle',name:'UW Seattle'};
  assert.deepEqual(validateSchoolDefinitions([school]),[school]);
  for(const value of [[],null,[school,school],[school,{schoolId:'xx',spaceId:'uw-seattle'}],[{schoolId:'uw;drop',spaceId:'uw'}],[{...school,package:'/tmp/execute.mjs'}]])
    assert.throws(()=>validateSchoolDefinitions(value));
});
