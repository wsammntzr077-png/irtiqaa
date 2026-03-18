const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SECRET_KEY;

async function sb(path, method, body) {
  method = method || 'GET';
  const res = await fetch(SB_URL + '/rest/v1/' + path, {
    method: method,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SB_KEY,
      'Authorization': 'Bearer ' + SB_KEY,
      'Prefer': 'return=representation'
    },
    body: body ? JSON.stringify(body) : null
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch(e) { return text; }
}

module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action;
  const body = req.body || {};

  try {

    if (action === 'adminLogin') {
      if (body.password !== 'irtiqaa2020') {
        return res.json({ success: false, error: 'رمز الدخول غير صحيح' });
      }
      const data = await sb('members?role=eq.admin&status=eq.active&select=*');
      if (!data.length) return res.json({ success: false, error: 'لا يوجد حساب إداري' });
      const m = data[0];
      delete m.password_hash;
      return res.json({ success: true, data: m });
    }

    if (action === 'login') {
      const { username, password } = body;
      const data = await sb('members?username=eq.' + encodeURIComponent(username) + '&password_hash=eq.' + encodeURIComponent(password) + '&select=*');
      if (!data.length) return res.json({ success: false, error: 'اسم المستخدم أو الرمز غير صحيح' });
      const member = data[0];
      if (member.status === 'pending') return res.json({ success: false, error: 'حسابك قيد المراجعة من الإدارة' });
      if (member.status === 'rejected') return res.json({ success: false, error: 'تم رفض طلب تسجيلك' });
      if (member.status === 'suspended') return res.json({ success: false, error: 'حسابك موقوف' });
      delete member.password_hash;
      return res.json({ success: true, data: member });
    }

    if (action === 'register') {
      const { full_name, username, password, phone } = body;
      const exists = await sb('members?username=eq.' + encodeURIComponent(username) + '&select=id');
      if (exists.length) return res.json({ success: false, error: 'اسم المستخدم مستخدم مسبقاً' });
      const data = await sb('members', 'POST', { full_name, username, password_hash: password, phone, status: 'pending', role: 'member' });
      return res.json({ success: true, data: data[0] });
    }

    if (action === 'getMembers') {
      const data = await sb('members?select=*,subscriptions(*)&order=points.desc');
      return res.json({ success: true, data: data.map(function(m) { delete m.password_hash; return m; }) });
    }

    if (action === 'getMember') {
      const id = req.query.id;
      const data = await sb('members?id=eq.' + id + '&select=*,subscriptions(*),event_registrations(*,events(*)),competition_participants(*,competitions(*))');
      if (!data.length) return res.json({ success: false });
      const m = data[0];
      delete m.password_hash;
      return res.json({ success: true, data: m });
    }

    if (action === 'getMemberPassword') {
      const id = req.query.id;
      const data = await sb('members?id=eq.' + id + '&select=password_hash');
      if (!data.length) return res.json({ success: false });
      return res.json({ success: true, data: data[0].password_hash });
    }

    if (action === 'updateMemberStatus') {
      const { id, status } = body;
      await sb('members?id=eq.' + id, 'PATCH', { status });
      return res.json({ success: true });
    }

    if (action === 'addPoints') {
      const { id, points } = body;
      const m = await sb('members?id=eq.' + id + '&select=points');
      const newPoints = ((m[0] && m[0].points) || 0) + points;
      await sb('members?id=eq.' + id, 'PATCH', { points: newPoints });
      return res.json({ success: true });
    }

    if (action === 'getPendingMembers') {
      const data = await sb('members?status=eq.pending&select=*&order=created_at.asc');
      return res.json({ success: true, data: data.map(function(m) { delete m.password_hash; return m; }) });
    }

    if (action === 'getPendingPhotos') {
      const data = await sb('members?photo_status=eq.pending&select=id,full_name,username,photo_pending_url');
      return res.json({ success: true, data });
    }

    if (action === 'approvePhoto') {
      const { id } = body;
      const m = await sb('members?id=eq.' + id + '&select=photo_pending_url');
      if (m.length) {
        await sb('members?id=eq.' + id, 'PATCH', {
          photo_url: m[0].photo_pending_url,
          photo_pending_url: null,
          photo_status: 'approved',
          photo_last_changed: new Date().toISOString()
        });
      }
      return res.json({ success: true });
    }

    if (action === 'rejectPhoto') {
      const { id } = body;
      await sb('members?id=eq.' + id, 'PATCH', { photo_pending_url: null, photo_status: 'none' });
      return res.json({ success: true });
    }

    if (action === 'uploadPhoto') {
      const { id, imageData } = body;
      const m = await sb('members?id=eq.' + id + '&select=photo_last_changed');
      if (m.length && m[0].photo_last_changed) {
        const diff = (new Date() - new Date(m[0].photo_last_changed)) / (1000 * 60 * 60 * 24);
        if (diff < 60) return res.json({ success: false, error: 'يجب الانتظار ' + Math.ceil(60 - diff) + ' يوماً قبل تغيير الصورة' });
      }
      const base64 = imageData.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64, 'base64');
      const fileName = id + '_' + Date.now() + '.jpg';
      const uploadRes = await fetch(SB_URL + '/storage/v1/object/avatars/' + fileName, {
        method: 'POST',
        headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Content-Type': 'image/jpeg' },
        body: buffer
      });
      if (!uploadRes.ok) return res.json({ success: false, error: 'فشل رفع الصورة' });
      const url = SB_URL + '/storage/v1/object/public/avatars/' + fileName;
      await sb('members?id=eq.' + id, 'PATCH', { photo_pending_url: url, photo_status: 'pending' });
      return res.json({ success: true });
    }

    if (action === 'getNotes') {
      const member_id = req.query.member_id;
      const data = await sb('admin_notes?member_id=eq.' + member_id + '&order=created_at.desc');
      return res.json({ success: true, data });
    }

    if (action === 'addNote') {
      const data = await sb('admin_notes', 'POST', body);
      return res.json({ success: true, data: data[0] });
    }

    if (action === 'addSubscription') {
      if (body.admin_password !== 'malia123') return res.json({ success: false, error: 'رمز المالية غير صحيح' });
      delete body.admin_password;
      const data = await sb('subscriptions', 'POST', body);
      return res.json({ success: true, data: data[0] });
    }

    if (action === 'getSubscriptions') {
      const member_id = req.query.member_id;
      const data = await sb('subscriptions?member_id=eq.' + member_id + '&order=created_at.desc');
      return res.json({ success: true, data });
    }

    if (action === 'getEvents') {
      const data = await sb('events?select=*,event_registrations(count)&order=start_date.desc');
      return res.json({ success: true, data });
    }

    if (action === 'createEvent') {
      const data = await sb('events', 'POST', body);
      return res.json({ success: true, data: data[0] });
    }

    if (action === 'registerEvent') {
      const { event_id, member_id } = body;
      const ev = await sb('events?id=eq.' + event_id + '&select=status');
      if (!ev.length || ev[0].status !== 'open') return res.json({ success: false, error: 'التسجيل مغلق' });
      const data = await sb('event_registrations', 'POST', { event_id, member_id });
      return res.json({ success: true, data: data[0] });
    }

    if (action === 'getCompetitions') {
      const data = await sb('competitions?select=*,competition_questions(count),competition_participants(count)&order=created_at.desc');
      return res.json({ success: true, data });
    }

    if (action === 'createCompetition') {
      const questions = body.questions;
      delete body.questions;
      const comp = await sb('competitions', 'POST', body);
      if (!comp[0]) return res.json({ success: false, error: 'فشل إنشاء المسابقة' });
      for (var i = 0; i < questions.length; i++) {
        await sb('competition_questions', 'POST', Object.assign({}, questions[i], { competition_id: comp[0].id, order_num: i }));
      }
      return res.json({ success: true, data: comp[0] });
    }

    if (action === 'getCompetitionQuestions') {
      const competition_id = req.query.competition_id;
      const data = await sb('competition_questions?competition_id=eq.' + competition_id + '&order=order_num.asc');
      return res.json({ success: true, data });
    }

    if (action === 'submitCompetition') {
      const { competition_id, member_id, answers } = body;
      const questions = await sb('competition_questions?competition_id=eq.' + competition_id + '&select=id,correct_answer');
      var correct = 0;
      questions.forEach(function(q) { if (answers[q.id] === q.correct_answer) correct++; });
      const data = await sb('competition_participants', 'POST', {
        competition_id, member_id, answers,
        correct_count: correct,
        total_questions: questions.length,
        completed_at: new Date().toISOString()
      });
      return res.json({ success: true, data: data[0], correct_count: correct, total: questions.length });
    }

    if (action === 'getCompetitionResults') {
      const competition_id = req.query.competition_id;
      const data = await sb('competition_participants?competition_id=eq.' + competition_id + '&select=*,members(full_name,username)&order=correct_count.desc');
      return res.json({ success: true, data });
    }

    if (action === 'hasParticipated') {
      const { competition_id, member_id } = req.query;
      const data = await sb('competition_participants?competition_id=eq.' + competition_id + '&member_id=eq.' + member_id + '&select=id,correct_count,total_questions');
      return res.json({ success: true, participated: data.length > 0, data: data[0] || null });
    }

    if (action === 'getStats') {
      const members = await sb('members?select=id,status,role');
      const events = await sb('events?select=id');
      const pending = await sb('members?status=eq.pending&select=id');
      const pendingPhotos = await sb('members?photo_status=eq.pending&select=id');
      return res.json({
        success: true,
        data: {
          totalMembers: members.filter(function(m) { return m.role === 'member'; }).length,
          activeMembers: members.filter(function(m) { return m.status === 'active' && m.role === 'member'; }).length,
          pendingMembers: pending.length,
          pendingPhotos: pendingPhotos.length,
          totalEvents: events.length
        }
      });
    }

    return res.status(400).json({ error: 'Unknown action: ' + action });

  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
};
