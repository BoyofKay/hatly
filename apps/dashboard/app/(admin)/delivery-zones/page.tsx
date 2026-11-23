'use client';

import { useEffect, useMemo, useState } from 'react';
import { DeliveryZone, MANAGE_SERVICE_AREAS, MANAGE_DELIVERY_FEE_MULTIPLIER,
  listDeliveryZones, saveDeliveryZoneGroup, removeDeliveryZoneGroup, zoneErrorMessage,
  ZoneGroupSaveInput } from '../../../lib/api/admin-delivery-zones';
import { ServiceArea, listServiceAreas } from '../../../lib/api/admin-service-areas';
import { useAdminPermission } from '../../../lib/auth/use-admin-permission';
import { formatMinor, parseEgpToMinorAllowZero } from '../../../lib/money';
import { useLang } from '../../../lib/ui/lang';

type Child = { key: string; id?: string; name: string; nameAr: string; fee: string; isActive: boolean };
type Draft = {
  original?: { serviceAreaId: string; zoneName: string; zoneNameAr: string };
  serviceAreaId: string; zoneName: string; zoneNameAr: string; displayOrder: string; isActive: boolean;
  children: Child[];
};
type Group = {
  key: string; serviceAreaId: string; zoneName: string; zoneNameAr: string;
  children: DeliveryZone[]; displayOrder: number; isActive: boolean;
};
const blankChild = (id: number): Child => ({key: 'new-'+id, name: '', nameAr: '', fee: '15.00', isActive: true});
const nameIsSingle = (s: string) => !!s.trim() && !/[,،;|\r\n]/.test(s);
const groupKey = (a: string, b: string, c: string) => JSON.stringify([a,b,c]);

function toDraft(group: Group): Draft {
  return {
    original: {serviceAreaId:group.serviceAreaId,zoneName:group.zoneName,zoneNameAr:group.zoneNameAr},
    serviceAreaId: group.serviceAreaId, zoneName:group.zoneName, zoneNameAr:group.zoneNameAr,
    displayOrder:String(group.displayOrder), isActive:group.isActive,
    children:group.children.map(c=>({key:c.id,id:c.id,name:c.name,nameAr:c.nameAr,fee:formatMinor(c.deliveryFeeMinor),isActive:c.isActive})),
  };
}

export default function DeliveryZonesPage() {
  const { t } = useLang();
  const canManage = useAdminPermission(MANAGE_SERVICE_AREAS) === true;
  const canPrice = useAdminPermission(MANAGE_DELIVERY_FEE_MULTIPLIER) === true;
  const canSave = canManage && canPrice;
  const [zones,setZones] = useState<DeliveryZone[]>([]);
  const [areas,setAreas] = useState<ServiceArea[]>([]);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState<string|null>(null);
  const [expanded,setExpanded] = useState<string|null>(null);
  const [draft,setDraft] = useState<Draft|null>(null);
  const [busy,setBusy] = useState(false);
  const [formError,setFormError] = useState<string|null>(null);
  const [removeConfirm,setRemoveConfirm] = useState(false);
  const [search,setSearch] = useState('');
  const [statusFilter,setStatusFilter] = useState('all');
  const [childCounter,setChildCounter] = useState(1);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [z,a]=await Promise.all([listDeliveryZones(),listServiceAreas()]);
      setZones(z); setAreas(a);
    } catch(e) {setError(zoneErrorMessage(e,'Unable to load delivery zones.'));}
    finally {setLoading(false);}
  }
  useEffect(()=>{void refresh();},[]);

  const groups=useMemo(()=>{
    const map=new Map<string,Group>();
    for(const z of zones) {
      if (!z.isSelectable || !z.zoneName || !z.zoneNameAr) continue;
      const key=groupKey(z.serviceAreaId,z.zoneName,z.zoneNameAr);
      let g=map.get(key);
      if(!g) {
        g={key,serviceAreaId:z.serviceAreaId,zoneName:z.zoneName,zoneNameAr:z.zoneNameAr,
          children:[],displayOrder:z.displayOrder,isActive:z.parentIsActive !== false};
        map.set(key,g);
      }
      g.children.push(z);
      g.displayOrder=Math.min(g.displayOrder,z.displayOrder);
    }
    return [...map.values()].sort((a,b)=>a.displayOrder-b.displayOrder || a.zoneNameAr.localeCompare(b.zoneNameAr));
  },[zones]);

  const filtered=groups.filter(g=>{
    if(statusFilter==='active'&&!g.isActive || statusFilter==='inactive'&&g.isActive) return false;
    const q=search.trim().toLowerCase();
    return !q || [g.zoneName,g.zoneNameAr,...g.children.flatMap(c=>[c.name,c.nameAr])].some(x=>x.toLowerCase().includes(q));
  });
  const areaMap=new Map(areas.map(a=>[a.id,a]));
  const serviceZones=draft ? zones.filter(z=>z.serviceAreaId===draft.serviceAreaId) : [];
  const existingLocation=(draft?.original ? serviceZones.find(z=>z.zoneName===draft.original?.zoneName && z.zoneNameAr===draft.original?.zoneNameAr) : null)
    ?? serviceZones[0];
  function openGroup(g:Group) {
    if(busy) return;
    if(expanded===g.key) {setExpanded(null);setDraft(null);return;}
    setDraft(toDraft(g));setExpanded(g.key);setFormError(null);setRemoveConfirm(false);
  }
  function newGroup() {
    if(busy) return;
    const areaId=areas.find(a=>a.isActive && zones.some(z=>z.serviceAreaId===a.id))?.id ?? areas[0]?.id ?? '';
    setDraft({serviceAreaId:areaId,zoneName:'',zoneNameAr:'',displayOrder:String(groups.length+1),isActive:true,children:[blankChild(childCounter)]});
    setChildCounter(c=>c+1);setExpanded('__new');setFormError(null);setRemoveConfirm(false);
  }
  const change=(patch:Partial<Draft>)=>setDraft(d=>d?{...d,...patch}:d);
  const changeChild=(key:string, patch:Partial<Child>)=>setDraft(d=>d?{
    ...d,children:d.children.map(c=>c.key===key?{...c,...patch}:c)
  }:d);
  const cancel=()=>{setExpanded(null);setDraft(null);setRemoveConfirm(false);setFormError(null);};
  async function save() {
    if(!draft || busy) return;
    if(!canSave) return setFormError('Both service-area management and delivery-fee permissions are required.');
    if(!draft.serviceAreaId || !areas.some(a=>a.id===draft.serviceAreaId)) return setFormError('Select a Service Area.');
    if(!existingLocation) return setFormError('This Service Area has no existing governorate/city data. Configure its location before adding a zone.');
    if(!nameIsSingle(draft.zoneName)||!nameIsSingle(draft.zoneNameAr)) return setFormError('Enter one English and one Arabic Delivery Zone name.');
    const displayOrder=Number(draft.displayOrder);
    if(!Number.isInteger(displayOrder)||displayOrder<0||displayOrder>100000) return setFormError('Display order must be an integer from 0 to 100000.');
    if(!draft.children.length) return setFormError('At least one neighborhood/village is required.');
    const children:ZoneGroupSaveInput['neighborhoods']=[];
    for(const child of draft.children) {
      if(!nameIsSingle(child.name)||!nameIsSingle(child.nameAr)) return setFormError('Every neighborhood/village needs one English name and one Arabic name (not a list).');
      const fee=parseEgpToMinorAllowZero(child.fee);
      if(!fee.ok) return setFormError('Enter a valid delivery fee in EGP for every neighborhood/village.');
      children.push({id:child.id,name:child.name.trim(),nameAr:child.nameAr.trim(),deliveryFeeMinor:fee.minor,isActive:child.isActive});
    }
    setBusy(true);setFormError(null);
    try {
      await saveDeliveryZoneGroup({
        ...draft.original && {originalServiceAreaId:draft.original.serviceAreaId,
          originalZoneName:draft.original.zoneName,originalZoneNameAr:draft.original.zoneNameAr},
        serviceAreaId:draft.serviceAreaId,zoneName:draft.zoneName.trim(),zoneNameAr:draft.zoneNameAr.trim(),
        displayOrder,isActive:draft.isActive,neighborhoods:children
      });
      cancel();await refresh();
    } catch(e) {setFormError(zoneErrorMessage(e,'Could not save Delivery Zone. No changes were applied.'));}
    finally {setBusy(false);}
  }
  async function remove() {
    if(!draft?.original || busy || !canManage) return;
    setBusy(true);setFormError(null);
    try {
      await removeDeliveryZoneGroup(draft.original);
      cancel();await refresh();
    }catch(e){setFormError(zoneErrorMessage(e,'Could not remove Delivery Zone.'));}
    finally{setBusy(false);}
  }
  function editor() {
    if(!draft) return null;
    return <div className="space-y-4 rounded-b-xl border-x border-b border-gray-200 bg-gray-50 p-4" data-testid="zone-group-editor">
      <h3 className="text-base font-semibold">{t('Delivery Zone Details','بيانات منطقة التوصيل')}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm sm:col-span-2">
          <span className="font-medium">{t('Service Area','منطقة الخدمة')} *</span>
          <select data-testid="group-service-area" className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2" value={draft.serviceAreaId}
            onChange={e=>change({serviceAreaId:e.target.value})} disabled={!canSave || busy}>
            <option value="">{t('Choose Service Area','اختر منطقة الخدمة')}</option>
            {areas.map(a=><option key={a.id} value={a.id}>{a.name} / {a.nameAr??''}{!a.isActive?' (Inactive)':''}</option>)}
          </select>
        </label>
        <label className="block text-sm">
          <span className="font-medium">{t('Delivery Zone (EN)','منطقة التوصيل (إنجليزي)')} *</span>
          <input data-testid="group-zone-en" className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2" value={draft.zoneName} onChange={e=>change({zoneName:e.target.value})} disabled={!canSave||busy}/>
        </label>
        <label className="block text-sm">
          <span className="font-medium">{t('Delivery Zone (AR)','منطقة التوصيل (عربي)')} *</span>
          <input data-testid="group-zone-ar" dir="rtl" className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2" value={draft.zoneNameAr} onChange={e=>change({zoneNameAr:e.target.value})} disabled={!canSave||busy}/>
        </label>
        <label className="block text-sm">
          <span className="font-medium">{t('Display Order','ترتيب العرض')}</span>
          <input data-testid="group-display-order" type="number" min="0" max="100000" className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2" value={draft.displayOrder} onChange={e=>change({displayOrder:e.target.value})} disabled={!canSave||busy}/>
        </label>
        <div className="flex flex-wrap items-end gap-2 text-sm">
          <span className="font-medium">{t('Status','الحالة')}:</span>
          <span className={draft.isActive?'text-green-700':'text-gray-600'}>{draft.isActive?t('Active','نشط'):t('Inactive','غير نشط')}</span>
          <button type="button" className="rounded-lg border bg-white px-3 py-2" disabled={!canSave||busy} onClick={()=>change({isActive:!draft.isActive})}>
            {draft.isActive?t('Deactivate','إيقاف'):t('Activate','تفعيل')}
          </button>
        </div>
      </div>
      <p data-testid="zone-location-hint" className="rounded-lg bg-white px-3 py-2 text-xs text-gray-600">
        {t('Location (read-only)','الموقع (للعرض فقط)')}: {existingLocation
          ? [existingLocation.governorate,existingLocation.governorateAr,existingLocation.city,existingLocation.cityAr].join(' / ')
          : t('No location data configured for the selected Service Area.','لا توجد بيانات موقع لمنطقة الخدمة المختارة.')}
      </p>
      <div className="border-t border-gray-200 pt-4">
        <h3 className="font-semibold">{t('Neighborhoods / Villages','الأحياء / القرى')}</h3>
        <p className="mb-3 text-xs text-gray-500">{t('One entry per neighborhood, with its own fee and status.','سجل مستقل لكل حي أو قرية برسوم وحالة منفصلة.')}</p>
        <div className="space-y-3">
          {draft.children.map((c,i)=><div key={c.key} data-testid="group-child-row" className="rounded-lg border border-gray-200 bg-white p-3">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_110px]">
              <label className="block text-xs font-medium">{t('Neighborhood / Village (EN)','الحي / القرية (إنجليزي)')} *
                <input value={c.name} onChange={e=>changeChild(c.key,{name:e.target.value})} disabled={!canSave||busy} className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-2 text-sm"/>
              </label>
              <label className="block text-xs font-medium">{t('Neighborhood / Village (AR)','الحي / القرية (عربي)')} *
                <input dir="rtl" value={c.nameAr} onChange={e=>changeChild(c.key,{nameAr:e.target.value})} disabled={!canSave||busy} className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-2 text-sm"/>
              </label>
              <label className="block text-xs font-medium">{t('Fee (EGP)','رسوم التوصيل (جنيه)')} *
                <input inputMode="decimal" value={c.fee} onChange={e=>changeChild(c.key,{fee:e.target.value})} disabled={!canSave||busy} className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-2 text-sm"/>
              </label>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3 text-xs">
              <button type="button" className="rounded-md border px-3 py-2" onClick={()=>changeChild(c.key,{isActive:!c.isActive})} disabled={!canSave||busy}>
                {c.isActive?t('Active — Deactivate','نشط — إيقاف'):t('Inactive — Activate','غير نشط — تفعيل')}
              </button>
              {i>0?<button type="button" data-testid="remove-child" className="rounded-md px-3 py-2 text-red-700 hover:bg-red-50" disabled={!canSave||busy}
                onClick={()=>change({children:draft.children.filter(x=>x.key!==c.key)})}>{t('Remove','حذف')}</button>
                :<span className="text-gray-400">{t('At least one required','سجل واحد مطلوب على الأقل')}</span>}
            </div>
          </div>)}
        </div>
        <button type="button" data-testid="add-group-child" className="mt-3 rounded-lg border border-hatly-orange px-3 py-2 text-sm font-medium text-hatly-orangeDark" disabled={!canSave||busy}
          onClick={()=>{change({children:[...draft.children,blankChild(childCounter)]});setChildCounter(c=>c+1);}}>
          + {t('Add Neighborhood / Village','إضافة حي / قرية')}
        </button>
      </div>
      {formError&&<p role="alert" data-testid="group-form-error" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{formError}</p>}
      {removeConfirm&&<div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm">
        <p>{t('Remove this Delivery Zone from future selections? Existing saved addresses and order history are preserved.','إزالة منطقة التوصيل من الاختيارات الجديدة؟ العناوين المحفوظة وسجل الطلبات محفوظان.')}</p>
        <div className="mt-2 flex gap-2"><button type="button" disabled={busy} onClick={()=>setRemoveConfirm(false)} className="rounded border bg-white px-3 py-2">{t('Keep Zone','الاحتفاظ بالمنطقة')}</button>
        <button type="button" disabled={busy} onClick={()=>void remove()} className="rounded bg-red-700 px-3 py-2 text-white">{t('Confirm Removal','تأكيد الحذف')}</button></div>
      </div>}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <div>{draft.original&&<button type="button" disabled={!canManage||busy} onClick={()=>setRemoveConfirm(true)} className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-700">{t('Remove Delivery Zone','حذف منطقة التوصيل')}</button>}</div>
        <div className="flex gap-2">
          <button type="button" onClick={cancel} disabled={busy} className="rounded-lg border bg-white px-4 py-2 text-sm">{t('Cancel','إلغاء')}</button>
          <button type="button" data-testid="save-zone-group" onClick={()=>void save()} disabled={!canSave||busy} className="rounded-lg bg-hatly-orange px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {busy?t('Saving…','جارٍ الحفظ…'):t('Save Changes','حفظ التغييرات')}
          </button>
        </div>
      </div>
    </div>;
  }

  return <div className="max-w-6xl space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-semibold">{t('Delivery Zones','مناطق التوصيل')}</h1>
        <p className="text-sm text-gray-600">{t('Each zone contains individually priced neighborhoods and villages.','كل منطقة تحتوي على أحياء وقرى برسوم توصيل مستقلة.')}</p></div>
      <button type="button" data-testid="zone-new" disabled={!canSave||busy} onClick={newGroup} className="rounded-lg bg-hatly-orange px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
        + {t('New Delivery Zone','منطقة توصيل جديدة')}
      </button>
    </div>
    <div className="flex flex-wrap gap-2">
      <input aria-label={t('Search zones','البحث في المناطق')} value={search} onChange={e=>setSearch(e.target.value)} placeholder={t('Search zones or neighborhoods','بحث في المناطق أو الأحياء')} className="min-h-[44px] flex-1 rounded-lg border px-3 text-sm"/>
      <select aria-label={t('Status','الحالة')} value={statusFilter} onChange={e=>setStatusFilter(e.target.value)} className="rounded-lg border bg-white px-3 text-sm">
        <option value="all">{t('All','الكل')}</option><option value="active">{t('Active','نشط')}</option><option value="inactive">{t('Inactive','غير نشط')}</option>
      </select>
    </div>
    {error&&<p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {loading&&<p className="text-sm text-gray-500">{t('Loading…','جارٍ التحميل…')}</p>}
    {!loading && !error && groups.length===0 && <p className="text-sm text-gray-500">{t('No delivery zones configured.','لا توجد مناطق توصيل.')}</p>}
    {expanded==='__new'&&<div className="rounded-xl border border-gray-200">
      <div className="bg-white px-4 py-3 font-semibold">{t('New Delivery Zone','منطقة توصيل جديدة')}</div>{editor()}</div>}
    {filtered.map(g=><div key={g.key} className="overflow-hidden rounded-xl border border-gray-200 bg-white" data-testid="group-zone">
      <button type="button" className="flex w-full items-center justify-between gap-3 px-4 py-4 text-start hover:bg-gray-50"
        onClick={()=>openGroup(g)} aria-expanded={expanded===g.key}>
        <div><p className="font-semibold">{g.zoneName} / {g.zoneNameAr}</p><p className="text-xs text-gray-500">{areaMap.get(g.serviceAreaId)?.name??'Service Area'} · {g.children.length} {t('neighborhoods / villages','حي / قرية')}</p></div>
        <div className="flex items-center gap-3"><span className={g.isActive?'text-xs text-green-700':'text-xs text-gray-500'}>{g.isActive?t('Active','نشط'):t('Inactive','غير نشط')}</span><span aria-hidden="true">{expanded===g.key?'▴':'▾'}</span></div>
      </button>
      {expanded===g.key&&editor()}
    </div>)}
  </div>;
}
