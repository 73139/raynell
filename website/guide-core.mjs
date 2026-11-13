/* Dependency order comes from the current public task data, not a fixed wipe list. */
export function buildKappaLine(tasks=[],statusOf=()=> 'todo'){
 const byId=new Map(tasks.map(t=>[t.id,t])),required=tasks.filter(t=>t.kappaRequired===true);
 const visited=new Set(),visiting=new Set(),rows=[],cycles=new Set();
 function visit(task){
  if(visited.has(task.id))return;
  if(visiting.has(task.id)){cycles.add(task.id);return;}
  visiting.add(task.id);
  for(const req of task.requirements||[])if(byId.has(req.taskId))visit(byId.get(req.taskId));
  visiting.delete(task.id);visited.add(task.id);
  const prerequisites=(task.requirements||[]).map(req=>({id:req.taskId,name:byId.get(req.taskId)?.name||req.taskId,status:statusOf(req.taskId)}));
  rows.push({task,status:statusOf(task.id),prerequisites,blocked:prerequisites.some(p=>p.status!=='done')});
 }
 for(const task of required)visit(task);
 return {required:required.length,done:required.filter(t=>statusOf(t.id)==='done').length,rows,cycles:[...cycles]};
}
export function validRoutePoints(route){
 return (route?.points||[]).filter(p=>typeof p.label==='string'&&Number.isFinite(p.x)&&Number.isFinite(p.z));
}
