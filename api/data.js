const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SECRET_KEY;

async function query(path, method, body) {
  const r = await fetch(SB_URL + '/rest/v1/' + path, {
    method: method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SB_KEY,
      'Authorization': 'Bearer ' + SB_KEY,
      'Prefer': 'return=representation'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  try { return await r.json(); } catch(e) { return []; }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action;
  const b = req.body || {};

  try {

    if (action === 'adminLogin') {
      const pw = b.password || '';
      if (pw !== 'irtiqaa2020') {
        return res.json({ success: false, error: 'رمز الدخول غير صحيح' });
      }
      const rows = await query('members?role=eq.admin&status=eq.active&select=*');
      if (!Array.isArray(rows) || !rows.length) {
        return res.json({ success: false, error: 'لا يوجد حساب إداري نشط' });
      }
      const m = Object.assign({}, rows[0]);
      delete m.password_hash;
      return res.json({ success: true, data: m });
    }

    if (action === 'login') {
      const rows = await query('members?username=eq.' + encodeURIComponent(b.username) + '&select=*');
      if (!Array.isArray(rows) || !rows.length) return res.json({ success: false, error: 'اسم المستخدم غير موجود' });
      const member = rows[0];
      if (member.password_hash !== b.password) return res.json({ success: false, error: 'الرمز غير صحيح' });
      if (member.status === 'pending') return res.json({ success: false, error: 'حسابك قيد المراجعة' });
      if (member.status === 'rejected') return res.json({ success: false, error: 'تم رفض طلبك' });
      if (member.status === 'suspended') return res.json({ success: false, error: 'حسابك موقوف' });
      const safe = Object.assign({}, member);
      delete safe.password_hash;
      return res.json({ success: true, data: safe });
    }

    if (action === 'register') {
      const exists = await query('members?username=eq.' + encodeURIComponent(b.username) + '&select=id');
      if (Array.isArray(exists) && exists.length) return res.json({ success: false, error: 'اسم المستخدم مستخدم مسبقاً' });
      const rows = await query('members', 'POST', { full_name: b.full_name, username: b.username, password_hash: b.password, phone: b.phone, status: 'pending', role: 'member' });
      return res.json({ success: true, data: Array.isArray(rows) ? rows[0] : rows });
    }

    if (action === 'getMembers') {
      // Get all members including pending for admin view
      const rows = await query('members?role=eq.member&select=*,subscriptions(*)&order=created_at.desc');
      if (!Array.isArray(rows)) return res.json({ success: true, data: [] });
      return res.json({ success: true, data: rows.map(function(m) { const s = Object.assign({}, m); delete s.password_hash; return s; }) });
    }

    if (action === 'getMember') {
      const rows = await query('members?id=eq.' + req.query.id + '&select=*,subscriptions(*),event_registrations(*,events(*)),competition_participants(*,competitions(*))');
      if (!Array.isArray(rows) || !rows.length) return res.json({ success: false });
      const m = Object.assign({}, rows[0]); delete m.password_hash;
      return res.json({ success: true, data: m });
    }

    if (action === 'getMemberPassword') {
      const rows = await query('members?id=eq.' + req.query.id + '&select=password_hash');
      if (!Array.isArray(rows) || !rows.length) return res.json({ success: false });
      return res.json({ success: true, data: rows[0].password_hash });
    }

    if (action === 'updateMemberStatus') {
      await query('members?id=eq.' + b.id, 'PATCH', { status: b.status });
      return res.json({ success: true });
    }

    if (action === 'addPoints') {
      const rows = await query('members?id=eq.' + b.id + '&select=points');
      const cur = (Array.isArray(rows) && rows.length) ? (rows[0].points || 0) : 0;
      await query('members?id=eq.' + b.id, 'PATCH', { points: cur + b.points });
      return res.json({ success: true });
    }

    if (action === 'getPendingMembers') {
      const rows = await query('members?status=eq.pending&select=*&order=created_at.asc');
      if (!Array.isArray(rows)) return res.json({ success: true, data: [] });
      return res.json({ success: true, data: rows.map(function(m) { const s = Object.assign({}, m); delete s.password_hash; return s; }) });
    }

    // ─────────────────────────────────────────────────────
    // PHOTO UPLOAD ENDPOINTS (محسّنة مع تعليقات توضيحية)
    // ─────────────────────────────────────────────────────

    if (action === 'getPendingPhotos') {
      // الحصول على جميع الصور المعلقة للمراجعة من الإدارة
      const rows = await query('members?photo_status=eq.pending&select=id,full_name,username,photo_pending_url');
      return res.json({ success: true, data: Array.isArray(rows) ? rows : [] });
    }

    if (action === 'approvePhoto') {
      // قبول صورة شخصية معلقة ونقلها من photo_pending_url إلى photo_url
      const rows = await query('members?id=eq.' + b.id + '&select=photo_pending_url');
      if (Array.isArray(rows) && rows.length) {
        await query('members?id=eq.' + b.id, 'PATCH', { 
          photo_url: rows[0].photo_pending_url,           // نقل الصورة المعلقة إلى الصورة الرسمية
          photo_pending_url: null,                         // حذف الصورة المعلقة
          photo_status: 'approved',                        // تحديث الحالة إلى موافق عليه
          photo_last_changed: new Date().toISOString()    // تسجيل وقت آخر تغيير
        });
      }
      return res.json({ success: true });
    }

    if (action === 'rejectPhoto') {
      // رفض صورة شخصية معلقة وحذفها
      await query('members?id=eq.' + b.id, 'PATCH', { 
        photo_pending_url: null,      // حذف الصورة المعلقة
        photo_status: 'none'          // إعادة الحالة إلى "لا توجد صورة معلقة"
      });
      return res.json({ success: true });
    }

    if (action === 'uploadPhoto') {
      // رفع صورة شخصية جديدة
      // التحقق من قيد التحديث (60 يوماً بين كل تحديث)
      const rows = await query('members?id=eq.' + b.id + '&select=photo_last_changed');
      if (Array.isArray(rows) && rows.length && rows[0].photo_last_changed) {
        const diff = (new Date() - new Date(rows[0].photo_last_changed)) / 86400000;
        if (diff < 60) return res.json({ success: false, error: 'يجب الانتظار ' + Math.ceil(60 - diff) + ' يوماً قبل تغيير الصورة مجدداً' });
      }
      
      // تحويل الصورة من Base64 إلى Buffer
      const buf = Buffer.from(b.imageData.replace(/^data:image\/\w+;base64,/, ''), 'base64');
      const fn = b.id + '_' + Date.now() + '.jpg';
      
      // رفع الصورة إلى Supabase Storage
      const up = await fetch(SB_URL + '/storage/v1/object/avatars/' + fn, { 
        method: 'POST', 
        headers: { 
          'apikey': SB_KEY, 
          'Authorization': 'Bearer ' + SB_KEY, 
          'Content-Type': 'image/jpeg' 
        }, 
        body: buf 
      });
      
      if (!up.ok) return res.json({ success: false, error: 'فشل رفع الصورة' });
      
      // حفظ معلومات الصورة في قاعدة البيانات مع حالة "معلقة" للموافقة من الإدارة
      await query('members?id=eq.' + b.id, 'PATCH', { 
        photo_pending_url: SB_URL + '/storage/v1/object/public/avatars/' + fn,  // رابط الصورة المعلقة
        photo_status: 'pending'                                                   // حالة الصورة: قيد الانتظار
      });
      
      return res.json({ success: true });
    }

    // ─────────────────────────────────────────────────────

    if (action === 'getNotes') {
      const rows = await query('admin_notes?member_id=eq.' + req.query.member_id + '&order=created_at.desc');
      return res.json({ success: true, data: Array.isArray(rows) ? rows : [] });
    }

    if (action === 'addNote') {
      const rows = await query('admin_notes', 'POST', b);
      return res.json({ success: true, data: Array.isArray(rows) ? rows[0] : rows });
    }

    if (action === 'addSubscription') {
      if (b.admin_password !== 'malia123') return res.json({ success: false, error: 'رمز المالية غير صحيح' });
      delete b.admin_password;
      const rows = await query('subscriptions', 'POST', b);
      return res.json({ success: true, data: Array.isArray(rows) ? rows[0] : rows });
    }

    if (action === 'getSubscriptions') {
      const rows = await query('subscriptions?member_id=eq.' + req.query.member_id + '&order=created_at.desc');
      return res.json({ success: true, data: Array.isArray(rows) ? rows : [] });
    }

    if (action === 'getEvents') {
      const rows = await query('events?select=*,event_registrations(count)&order=start_date.desc');
      return res.json({ success: true, data: Array.isArray(rows) ? rows : [] });
    }

    if (action === 'createEvent') {
      const rows = await query('events', 'POST', b);
      return res.json({ success: true, data: Array.isArray(rows) ? rows[0] : rows });
    }

    if (action === 'registerEvent') {
      const ev = await query('events?id=eq.' + b.event_id + '&select=status');
      if (!Array.isArray(ev) || !ev.length || ev[0].status !== 'open') return res.json({ success: false, error: 'التسجيل مغلق' });
      const rows = await query('event_registrations', 'POST', { event_id: b.event_id, member_id: b.member_id });
      return res.json({ success: true, data: Array.isArray(rows) ? rows[0] : rows });
    }

    if (action === 'getCompetitions') {
      const rows = await query('competitions?select=*,competition_questions(count),competition_participants(count)&order=created_at.desc');
      return res.json({ success: true, data: Array.isArray(rows) ? rows : [] });
    }

    if (action === 'createCompetition') {
      const qs = b.questions; delete b.questions;
      const comp = await query('competitions', 'POST', b);
      const cid = (Array.isArray(comp) ? comp[0] : comp).id;
      for (var i = 0; i < qs.length; i++) await query('competition_questions', 'POST', Object.assign({}, qs[i], { competition_id: cid, order_num: i }));
      return res.json({ success: true, data: Array.isArray(comp) ? comp[0] : comp });
    }

    if (action === 'getCompetitionQuestions') {
      const rows = await query('competition_questions?competition_id=eq.' + req.query.competition_id + '&order=order_num.asc');
      return res.json({ success: true, data: Array.isArray(rows) ? rows : [] });
    }

    if (action === 'submitCompetition') {
      const qs = await query('competition_questions?competition_id=eq.' + b.competition_id + '&select=id,correct_answer');
      var correct = 0;
      if (Array.isArray(qs)) qs.forEach(function(q) { if (b.answers[q.id] === q.correct_answer) correct++; });
      const rows = await query('competition_participants', 'POST', { competition_id: b.competition_id, member_id: b.member_id, answers: b.answers, correct_count: correct, total_questions: Array.isArray(qs) ? qs.length : 0, completed_at: new Date().toISOString() });
      return res.json({ success: true, data: Array.isArray(rows) ? rows[0] : rows, correct_count: correct, total: Array.isArray(qs) ? qs.length : 0 });
    }

    if (action === 'getCompetitionResults') {
      const rows = await query('competition_participants?competition_id=eq.' + req.query.competition_id + '&select=*,members(full_name,username)&order=correct_count.desc');
      return res.json({ success: true, data: Array.isArray(rows) ? rows : [] });
    }

    if (action === 'updateCompStatus') {
      await query('competitions?id=eq.' + b.id, 'PATCH', { status: b.status });
      return res.json({ success: true });
    }

    if (action === 'deleteComp') {
      await query('competition_questions?competition_id=eq.' + b.id, 'DELETE');
      await query('competition_participants?competition_id=eq.' + b.id, 'DELETE');
      await query('competitions?id=eq.' + b.id, 'DELETE');
      return res.json({ success: true });
    }

    if (action === 'hasParticipated') {
      const rows = await query('competition_participants?competition_id=eq.' + req.query.competition_id + '&member_id=eq.' + req.query.member_id + '&select=id,correct_count,total_questions');
      return res.json({ success: true, participated: Array.isArray(rows) && rows.length > 0, data: (Array.isArray(rows) && rows[0]) || null });
    }

    if (action === 'getStats') {
      const members = await query('members?select=id,status,role');
      const events = await query('events?select=id');
      const pending = await query('members?status=eq.pending&select=id');
      const photos = await query('members?photo_status=eq.pending&select=id');
      const m = Array.isArray(members) ? members : [];
      return res.json({ success: true, data: {
        totalMembers: m.filter(function(x){return x.role==='member' && x.status==='active';}).length,
        activeMembers: m.filter(function(x){return x.status==='active'&&x.role==='member';}).length,
        pendingMembers: Array.isArray(pending) ? pending.length : 0,
        pendingPhotos: Array.isArray(photos) ? photos.length : 0,
        totalEvents: Array.isArray(events) ? events.length : 0
      }});
    }

    return res.status(400).json({ error: 'Unknown: ' + action });
  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
};
