import assert from 'node:assert/strict';
import {snapTimeline} from '../timeline-snap.mjs';

const snap=options=>snapTimeline({pixelsPerFrame:1.2,targets:[0,90,150,360],...options});
assert.deepEqual(snap({value:87}),{value:90,target:90},'Start aligns to another edge');
assert.deepEqual(snap({value:58,offsets:[0,30]}),{value:60,target:90},'Moving aligns trailing edge without resizing');
assert.deepEqual(snap({value:147,min:61}),{value:150,target:150},'Resizing aligns its end');
assert.deepEqual(snap({value:105}),{value:105,target:null},'Outside the magnetic range remains free');
assert.deepEqual(snap({value:3}),{value:0,target:0},'Project start attracts nearby clips');
assert.deepEqual(snap({value:357}),{value:360,target:360},'Project end attracts nearby clips');
assert.deepEqual(snap({value:43,targets:[45]}),{value:45,target:45},'Playhead is a snap target');
assert.deepEqual(snap({value:3,targets:[20],offsets:[0,30]}),{value:3,target:null},'Snapping cannot move a clip before zero');
assert.deepEqual(snap({value:93,targets:[90],min:91}),{value:93,target:null},'Resizing cannot cross the minimum duration');
assert.equal(snap({value:84,pixelsPerFrame:2}).target,null,'Zooming in reduces the frame tolerance');
assert.equal(snap({value:84,pixelsPerFrame:1}).target,90,'The same frame distance snaps when zoomed out');
assert.deepEqual(snap({value:90,targets:[]}),{value:90,target:null},'No self-snapping when targets are absent');
assert.equal(snap({value:97,targets:[90,100]}).target,100,'Closest target wins');
console.log('Timeline magnetic snapping tests passed.');
