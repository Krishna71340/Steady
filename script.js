(() => {
  "use strict";

  const Utils = {
    APP_NAME: "Steady",
    STORAGE_KEY: "steady.v1",
    DAY_MS: 24 * 60 * 60 * 1000,
    COLORS: [
      "#6ee7ff",
      "#a78bfa",
      "#34d399",
      "#fbbf24",
      "#ff4d6d",
      "#60a5fa",
      "#f472b6",
      "#22c55e",
    ],

    clamp(value, min, max) {
      return Math.min(max, Math.max(min, value));
    },

    uid(prefix = "id") {
      const time = Date.now().toString(36);
      let rand = "";
      try {
        const buf = new Uint32Array(2);
        crypto.getRandomValues(buf);
        rand = (buf[0] ^ buf[1]).toString(36);
      } catch {
        rand = Math.random().toString(36).slice(2);
      }
      return `${prefix}_${time}_${rand.slice(0, 8)}`;
    },

    escapeHtml(input) {
      const str = String(input ?? "");
      return str
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    },

    startOfLocalDay(date) {
      return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
    },

    toDateKey(date = new Date()) {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, "0");
      const d = String(date.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    },

    dateFromKey(dateKey) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey));
      if (!m) return null;
      const y = Number(m[1]);
      const mo = Number(m[2]) - 1;
      const d = Number(m[3]);
      const dt = new Date(y, mo, d, 0, 0, 0, 0);
      if (Number.isNaN(dt.getTime())) return null;
      return dt;
    },

    daysLeft(dateKey, now = new Date()) {
      const target = Utils.dateFromKey(dateKey);
      if (!target) return null;
      const diffMs = Utils.startOfLocalDay(target).getTime() - Utils.startOfLocalDay(now).getTime();
      return Math.floor(diffMs / Utils.DAY_MS);
    },

    formatDateKey(dateKey) {
      const dt = Utils.dateFromKey(dateKey);
      if (!dt) return String(dateKey ?? "");
      try {
        return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" }).format(dt);
      } catch {
        return dt.toDateString();
      }
    },

    formatDaysLeft(days) {
      if (days === null || days === undefined) return "";
      if (days === 0) return "Today";
      if (days === 1) return "Tomorrow";
      if (days === -1) return "Yesterday";
      if (days > 1) return `In ${days} days`;
      return `${Math.abs(days)} days ago`;
    },

    formatDuration(seconds) {
      const s = Math.max(0, Math.floor(Number(seconds) || 0));
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const parts = [];
      if (h) parts.push(`${h}h`);
      parts.push(`${m}m`);
      return parts.join(" ");
    },

    formatTimer(totalSeconds) {
      const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
      const mm = String(Math.floor(s / 60)).padStart(2, "0");
      const ss = String(s % 60).padStart(2, "0");
      return `${mm}:${ss}`;
    },

    safeJsonParse(text) {
      try {
        return { ok: true, value: JSON.parse(text) };
      } catch (err) {
        return { ok: false, error: err };
      }
    },

    download(filename, text, mime = "application/json") {
      const blob = new Blob([text], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },

    async readFileAsText(file) {
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
        reader.onload = () => resolve(String(reader.result || ""));
        reader.readAsText(file);
      });
    },

    async readFileAsDataUrl(file) {
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
        reader.onload = () => resolve(String(reader.result || ""));
        reader.readAsDataURL(file);
      });
    },

    nearest(arr, scoreFn) {
      let best = null;
      let bestScore = Infinity;
      for (const item of arr) {
        const score = scoreFn(item);
        if (score < bestScore) {
          bestScore = score;
          best = item;
        }
      }
      return best;
    },
  };

  const Engine = {
    normalizeState(raw, base) {
      const src = typeof raw === "object" && raw ? raw : {};
      const out = {
        ...base,
        ...src,
        subjects: Array.isArray(src.subjects) ? src.subjects : [],
        exams: Array.isArray(src.exams) ? src.exams : [],
        focus: {
          ...base.focus,
          ...(typeof src.focus === "object" && src.focus ? src.focus : {}),
          settings: {
            ...base.focus.settings,
            ...(src.focus && typeof src.focus.settings === "object" && src.focus.settings ? src.focus.settings : {}),
          },
          history: Array.isArray(src.focus?.history) ? src.focus.history : [],
        },
        analytics: {
          ...base.analytics,
          ...(typeof src.analytics === "object" && src.analytics ? src.analytics : {}),
          daily: src.analytics && typeof src.analytics.daily === "object" && src.analytics.daily ? src.analytics.daily : {},
        },
        streak: {
          ...base.streak,
          ...(typeof src.streak === "object" && src.streak ? src.streak : {}),
        },
        ui: {
          ...base.ui,
          ...(typeof src.ui === "object" && src.ui ? src.ui : {}),
        },
      };

      out.version = 1;
      out.createdAt = typeof out.createdAt === "string" ? out.createdAt : base.createdAt;
      out.updatedAt = typeof out.updatedAt === "string" ? out.updatedAt : base.updatedAt;

      out.focus.settings.minutes = Utils.clamp(Number(out.focus.settings.minutes ?? 25), 10, 90);
      out.focus.settings.ambientEnabled = Boolean(out.focus.settings.ambientEnabled);
      out.focus.settings.ambientPreset = ["rain", "waves", "brown", "fan", "library", "white"].includes(
        out.focus.settings.ambientPreset,
      )
        ? out.focus.settings.ambientPreset
        : "rain";
      out.focus.settings.volume = Utils.clamp(Number(out.focus.settings.volume ?? 0.35), 0, 1);
      out.focus.settings.breakEnabled = Boolean(out.focus.settings.breakEnabled);
      out.focus.settings.breakMinutes = Utils.clamp(Number(out.focus.settings.breakMinutes ?? 5), 1, 20);
      out.focus.settings.lockEnabled = Boolean(out.focus.settings.lockEnabled);

      out.analytics.logs = Array.isArray(out.analytics.logs) ? out.analytics.logs : [];
      out.analytics.reflections =
        out.analytics.reflections && typeof out.analytics.reflections === "object" ? out.analytics.reflections : {};

      out.streak.current = Math.max(0, Number(out.streak.current) || 0);
      out.streak.longest = Math.max(0, Number(out.streak.longest) || 0);
      out.streak.lastActiveDate = typeof out.streak.lastActiveDate === "string" ? out.streak.lastActiveDate : null;

      out.ui.route = typeof out.ui.route === "string" ? out.ui.route : "dashboard";
      out.ui.theme = typeof out.ui.theme === "string" ? out.ui.theme : "default";
      out.ui.preset = typeof out.ui.preset === "string" ? out.ui.preset : "balanced";
      out.ui.devMode = Boolean(out.ui.devMode);
      out.ui.heatmapDays = [30, 60, 90].includes(Number(out.ui.heatmapDays)) ? Number(out.ui.heatmapDays) : 60;
      out.ui.missedNoticeDate = typeof out.ui.missedNoticeDate === "string" ? out.ui.missedNoticeDate : null;
      out.ui.lastMilestone = out.ui.lastMilestone ? Number(out.ui.lastMilestone) : null;
      out.ui.lastMilestoneToast = out.ui.lastMilestoneToast ? Number(out.ui.lastMilestoneToast) : null;

      out.gamification =
        out.gamification && typeof out.gamification === "object" ? out.gamification : { xp: 0, level: 1 };
      out.gamification.xp = Math.max(0, Number(out.gamification.xp) || 0);
      out.gamification.level = Math.max(1, Number(out.gamification.level) || 1);

      for (const subject of out.subjects) {
        if (!subject || typeof subject !== "object") continue;
        subject.id = typeof subject.id === "string" ? subject.id : Utils.uid("sub");
        subject.name = String(subject.name ?? "Untitled");
        subject.color = typeof subject.color === "string" ? subject.color : Utils.COLORS[0];
        subject.createdAt = typeof subject.createdAt === "string" ? subject.createdAt : new Date().toISOString();
        subject.weight = Utils.clamp(Number(subject.weight ?? 1), 1, 3);
        subject.collapsed = Boolean(subject.collapsed);
        subject.chapters = Array.isArray(subject.chapters) ? subject.chapters : [];

        for (const chapter of subject.chapters) {
          if (!chapter || typeof chapter !== "object") continue;
          chapter.id = typeof chapter.id === "string" ? chapter.id : Utils.uid("ch");
          chapter.title = String(chapter.title ?? "Untitled chapter");
          chapter.difficulty = Utils.clamp(Number(chapter.difficulty) || 2, 1, 3);
          chapter.createdAt = typeof chapter.createdAt === "string" ? chapter.createdAt : new Date().toISOString();
          chapter.completedAt = typeof chapter.completedAt === "string" ? chapter.completedAt : null;
          chapter.skipCount = Math.max(0, Number(chapter.skipCount) || 0);
          chapter.completeCount = Math.max(0, Number(chapter.completeCount) || 0);
          chapter.boost = Utils.clamp(Number(chapter.boost) || 0, -12, 12);
          chapter.lastSkippedAt = typeof chapter.lastSkippedAt === "string" ? chapter.lastSkippedAt : null;
          chapter.lastCompletedAt = typeof chapter.lastCompletedAt === "string" ? chapter.lastCompletedAt : chapter.completedAt;
        }
      }

      for (const exam of out.exams) {
        if (!exam || typeof exam !== "object") continue;
        exam.id = typeof exam.id === "string" ? exam.id : Utils.uid("ex");
        exam.title = String(exam.title ?? "Exam");
        exam.dateKey = typeof exam.dateKey === "string" ? exam.dateKey : Utils.toDateKey(new Date());
        exam.subjectId = typeof exam.subjectId === "string" ? exam.subjectId : null;
        exam.createdAt = typeof exam.createdAt === "string" ? exam.createdAt : new Date().toISOString();
      }

      if (!out.focus.assets || typeof out.focus.assets !== "object") out.focus.assets = {};

      out.focus.history = out.focus.history
        .filter((s) => s && typeof s === "object")
        .slice(-600)
        .map((s) => ({
          id: typeof s.id === "string" ? s.id : Utils.uid("fs"),
          startedAt: typeof s.startedAt === "string" ? s.startedAt : new Date().toISOString(),
          endedAt: typeof s.endedAt === "string" ? s.endedAt : null,
          durationSec: Math.max(0, Math.floor(Number(s.durationSec) || 0)),
          completed: Boolean(s.completed),
          task: s.task && typeof s.task === "object" ? s.task : {},
          ambient: s.ambient && typeof s.ambient === "object" ? s.ambient : {},
          createdAt: typeof s.createdAt === "string" ? s.createdAt : new Date().toISOString(),
        }));

      Engine.ensureStreakCurrent(out);
      return out;
    },

    ensureStreakCurrent(state, now = new Date()) {
      const last = state?.streak?.lastActiveDate;
      if (!last) return;
      const lastDt = Utils.dateFromKey(last);
      if (!lastDt) return;
      const todayKey = Utils.toDateKey(now);
      const yesterdayKey = Utils.toDateKey(new Date(Utils.startOfLocalDay(now).getTime() - Utils.DAY_MS));
      if (last === todayKey || last === yesterdayKey) return;
      if (state.streak.current > 0) state.streak.current = 0;
      if (state.ui && state.ui.missedNoticeDate !== todayKey) state.ui.missedNoticeDate = todayKey;
    },

    updateStreakOnActivity(state, dateKey, now = new Date()) {
      const todayKey = dateKey || Utils.toDateKey(now);
      const last = state.streak.lastActiveDate;
      if (last === todayKey) return;

      const yesterdayKey = Utils.toDateKey(new Date(Utils.startOfLocalDay(now).getTime() - Utils.DAY_MS));
      if (last === yesterdayKey) state.streak.current += 1;
      else state.streak.current = 1;

      state.streak.lastActiveDate = todayKey;
      state.streak.longest = Math.max(state.streak.longest, state.streak.current);
    },

    getSubject(state, subjectId) {
      return state.subjects.find((s) => s.id === subjectId) || null;
    },

    getChapter(state, subjectId, chapterId) {
      const subject = Engine.getSubject(state, subjectId);
      if (!subject) return null;
      const chapter = subject.chapters.find((c) => c.id === chapterId) || null;
      return chapter ? { subject, chapter } : null;
    },

    getExamsForSubject(state, subjectId) {
      if (!subjectId) return [];
      return state.exams.filter((e) => e.subjectId === subjectId);
    },

    getNearestExamForSubject(state, subjectId) {
      const exams = Engine.getExamsForSubject(state, subjectId);
      if (!exams.length) return null;
      return Utils.nearest(exams, (e) => {
        const dl = Utils.daysLeft(e.dateKey);
        return dl === null ? Infinity : dl;
      });
    },

    examUrgency(daysLeft) {
      if (daysLeft === null || daysLeft === undefined) return { score: 0, kind: "" };
      if (daysLeft <= 0) return { score: 100, kind: "danger" };
      if (daysLeft <= 3) return { score: 86 - daysLeft * 6, kind: "danger" };
      if (daysLeft <= 7) return { score: 60 - (daysLeft - 3) * 4, kind: "warn" };
      if (daysLeft <= 14) return { score: 36 - (daysLeft - 7) * 2, kind: "warn" };
      if (daysLeft <= 30) return { score: 16 - (daysLeft - 14) * 0.6, kind: "ok" };
      return { score: 6, kind: "ok" };
    },

    difficultyLabel(level) {
      const d = Utils.clamp(Number(level) || 2, 1, 3);
      if (d === 1) return { label: "Easy", kind: "ok" };
      if (d === 2) return { label: "Medium", kind: "primary" };
      return { label: "Hard", kind: "warn" };
    },

    computeTaskCandidates(state) {
      const tasks = [];
      const preset = state.ui?.preset || "balanced";
      const now = new Date();
      const weights = { difficulty: 1, urgency: 1, age: 1 };

      if (preset === "light") {
        weights.difficulty = 0.7;
        weights.urgency = 0.8;
        weights.age = 0.6;
      } else if (preset === "exam") {
        weights.difficulty = 1.1;
        weights.urgency = 1.4;
        weights.age = 0.8;
      } else if (preset === "revision") {
        weights.difficulty = 0.4;
        weights.urgency = 0.4;
        weights.age = 1.2;
      }

      const includeIncomplete = preset !== "revision";
      const includeReview = preset === "revision";

      for (const subject of state.subjects) {
        const exam = Engine.getNearestExamForSubject(state, subject.id);
        const days = exam ? Utils.daysLeft(exam.dateKey) : null;
        const urgency = Engine.examUrgency(days);
        const subjectWeight = (Utils.clamp(Number(subject.weight) || 1, 1, 3) - 1) * 6;

        for (const chapter of subject.chapters) {
          const difficulty = Utils.clamp(Number(chapter.difficulty) || 2, 1, 3);
          const difficultyScore = difficulty === 1 ? 10 : difficulty === 2 ? 18 : 26;
          const createdAt = chapter.createdAt ? new Date(chapter.createdAt) : now;
          const ageDays = Math.max(0, Math.floor((Utils.startOfLocalDay(now) - Utils.startOfLocalDay(createdAt)) / Utils.DAY_MS));
          const ageBoost = Math.min(10, ageDays) * weights.age;
          const skipCount = Math.max(0, Number(chapter.skipCount) || 0);
          const skipPenalty = skipCount * 3;
          const adaptiveBoost = Number(chapter.boost) || 0;

          if (!chapter.completedAt && includeIncomplete) {
            const urgencyScore = urgency.score * weights.urgency;
            const score = Math.round(
              difficultyScore * weights.difficulty + urgencyScore + subjectWeight + ageBoost + adaptiveBoost - skipPenalty,
            );
            tasks.push({
              type: "study",
              subjectId: subject.id,
              subjectName: subject.name,
              subjectColor: subject.color,
              chapterId: chapter.id,
              title: chapter.title,
              difficulty,
              skipCount,
              lastSkippedAt: chapter.lastSkippedAt || null,
              score,
              exam: exam ? { id: exam.id, title: exam.title, dateKey: exam.dateKey, daysLeft: days } : null,
              debug: {
                difficultyScore,
                urgencyScore,
                subjectWeight,
                ageBoost,
                adaptiveBoost,
                skipPenalty,
                preset,
              },
            });
          }

          if (includeReview && chapter.completedAt) {
            const completedAt = chapter.lastCompletedAt ? new Date(chapter.lastCompletedAt) : new Date(chapter.completedAt);
            const reviewAge = Math.max(
              0,
              Math.floor((Utils.startOfLocalDay(now) - Utils.startOfLocalDay(completedAt)) / Utils.DAY_MS),
            );
            if (reviewAge < 7) continue;
            const score = Math.round(reviewAge * 2 + subjectWeight + adaptiveBoost * 0.4);
            tasks.push({
              type: "review",
              subjectId: subject.id,
              subjectName: subject.name,
              subjectColor: subject.color,
              chapterId: chapter.id,
              title: chapter.title,
              difficulty,
              score,
              exam: null,
              debug: {
                reviewAge,
                subjectWeight,
                adaptiveBoost,
                preset,
              },
            });
          }
        }
      }
      tasks.sort((a, b) => b.score - a.score);
      return tasks;
    },

    getSmartRecommendation(state) {
      const tasks = Engine.computeTaskCandidates(state);
      return tasks.length ? tasks[0] : null;
    },

    getPlanSize(state, limit = 3) {
      return limit;
    },

    getTodaysPlan(state, limit = 3) {
      const size = Engine.getPlanSize(state, limit);
      return Engine.computeTaskCandidates(state).slice(0, size);
    },

    getMostUrgentTask(state) {
      const tasks = Engine.computeTaskCandidates(state);
      return tasks.length ? tasks[0] : null;
    },

    getProgress(state) {
      let total = 0;
      let done = 0;
      const bySubject = [];
      for (const subject of state.subjects) {
        const subjTotal = subject.chapters.length;
        const subjDone = subject.chapters.filter((c) => Boolean(c.completedAt)).length;
        total += subjTotal;
        done += subjDone;
        bySubject.push({
          id: subject.id,
          name: subject.name,
          color: subject.color,
          total: subjTotal,
          done: subjDone,
          pct: subjTotal ? Math.round((subjDone / subjTotal) * 100) : 0,
        });
      }
      const pct = total ? Math.round((done / total) * 100) : 0;
      bySubject.sort((a, b) => b.pct - a.pct);
      return { total, done, pct, bySubject };
    },

    getUpcomingExams(state, limit = 4) {
      const list = state.exams
        .map((e) => ({ ...e, daysLeft: Utils.daysLeft(e.dateKey) }))
        .filter((e) => e.daysLeft !== null)
        .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0));
      return list.slice(0, limit);
    },

    getDaily(state, dateKey) {
      const daily = state.analytics.daily || {};
      const entry = daily[dateKey];
      if (!entry || typeof entry !== "object") return { focusSeconds: 0, focusSessions: 0, completedChapters: 0 };
      return {
        focusSeconds: Math.max(0, Number(entry.focusSeconds) || 0),
        focusSessions: Math.max(0, Number(entry.focusSessions) || 0),
        completedChapters: Math.max(0, Number(entry.completedChapters) || 0),
      };
    },

    getFocusSummary(state) {
      const todayKey = Utils.toDateKey(new Date());
      const today = Engine.getDaily(state, todayKey);
      const last7 = { focusSeconds: 0, completedChapters: 0, focusSessions: 0 };
      for (let i = 0; i < 7; i++) {
        const key = Utils.toDateKey(new Date(Utils.startOfLocalDay(new Date()).getTime() - i * Utils.DAY_MS));
        const d = Engine.getDaily(state, key);
        last7.focusSeconds += d.focusSeconds;
        last7.focusSessions += d.focusSessions;
        last7.completedChapters += d.completedChapters;
      }
      const totalFocusSeconds = Object.values(state.analytics.daily || {}).reduce((acc, v) => {
        if (!v || typeof v !== "object") return acc;
        return acc + (Number(v.focusSeconds) || 0);
      }, 0);
      return { today, last7, totalFocusSeconds };
    },

    getFocusStats(state) {
      const sessions = (state.focus.history || []).filter((s) => s && s.completed);
      const total = sessions.reduce((acc, s) => acc + (Number(s.durationSec) || 0), 0);
      const avg = sessions.length ? Math.round(total / sessions.length) : 0;
      const bySubject = {};
      for (const s of sessions) {
        const subjectId = s.task?.subjectId;
        if (!subjectId) continue;
        bySubject[subjectId] = (bySubject[subjectId] || 0) + (Number(s.durationSec) || 0);
      }
      let topSubject = null;
      let topSeconds = 0;
      for (const [subjectId, seconds] of Object.entries(bySubject)) {
        if (seconds > topSeconds) {
          topSeconds = seconds;
          topSubject = subjectId;
        }
      }
      const subject = topSubject ? Engine.getSubject(state, topSubject) : null;
      return {
        averageSessionSec: avg,
        mostFocusedSubject: subject ? subject.name : "None yet",
        mostFocusedMinutes: Math.round(topSeconds / 60),
      };
    },

    getActivityLogs(state, limit = 30) {
      const logs = Array.isArray(state.analytics.logs) ? state.analytics.logs.slice() : [];
      logs.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      return logs.slice(0, limit);
    },

    getLastCompletedTask(state) {
      const logs = Engine.getActivityLogs(state, 20).filter((l) =>
        ["chapter.complete", "focus.complete", "review.complete"].includes(l.type),
      );
      return logs.length ? logs[0] : null;
    },

    getWeeklyPlan(state) {
      const tasks = Engine.computeTaskCandidates(state).slice(0, 21);
      const start = Utils.startOfLocalDay(new Date());
      const days = Array.from({ length: 7 }).map((_, idx) => ({
        dateKey: Utils.toDateKey(new Date(start.getTime() + idx * Utils.DAY_MS)),
        tasks: [],
      }));
      let idx = 0;
      for (const task of tasks) {
        days[idx % 7].tasks.push(task);
        idx += 1;
      }
      return days;
    },

    getResurfacingTasks(state, limit = 3) {
      const now = new Date();
      const startMs = Utils.startOfLocalDay(now).getTime();
      const tasks = [];
      for (const subject of state.subjects) {
        for (const chapter of subject.chapters) {
          if (chapter.completedAt) continue;
          const baseDate = chapter.lastSkippedAt ? new Date(chapter.lastSkippedAt) : new Date(chapter.createdAt || now);
          const baseMsRaw = Utils.startOfLocalDay(baseDate).getTime();
          const baseMs = Number.isNaN(baseMsRaw) ? startMs : baseMsRaw;
          const ageDays = Math.max(0, Math.floor((startMs - baseMs) / Utils.DAY_MS));
          const skipped = Math.max(0, Number(chapter.skipCount) || 0);
          if (ageDays < 10 && skipped < 2) continue;
          const score = ageDays * 2 + skipped * 4;
          tasks.push({
            type: "study",
            subjectId: subject.id,
            subjectName: subject.name,
            subjectColor: subject.color,
            chapterId: chapter.id,
            title: chapter.title,
            difficulty: chapter.difficulty,
            ageDays,
            skipped,
            score,
          });
        }
      }
      tasks.sort((a, b) => b.score - a.score);
      return tasks.slice(0, limit);
    },

    explainTask(task, state) {
      if (!task) return [];
      const reasons = [];
      if (task.exam && typeof task.exam.daysLeft === "number") {
        const daysLeft = task.exam.daysLeft;
        if (daysLeft <= 7) {
          reasons.push(`Exam in ${Utils.formatDaysLeft(daysLeft)}`);
        }
      }
      if (task.type === "study") {
        const skipped = Math.max(0, Number(task.skipCount) || 0);
        const lastSkip = task.lastSkippedAt ? new Date(task.lastSkippedAt) : null;
        const daysSinceSkip =
          lastSkip && !Number.isNaN(lastSkip.getTime())
            ? Math.floor((Utils.startOfLocalDay(new Date()) - Utils.startOfLocalDay(lastSkip)) / Utils.DAY_MS)
            : null;
        if (skipped > 0 && (daysSinceSkip === null || daysSinceSkip <= 7)) reasons.push("Skipped recently");
      }
      const preset = state.ui?.preset || "balanced";
      if (preset === "light") reasons.push("Low-energy pick");
      else if (preset === "balanced" && task.difficulty === 2) reasons.push("Good balance today");
      if (!reasons.length) reasons.push("Keeps steady momentum");
      return reasons.slice(0, 3);
    },

    getMotivationLine(dateKey) {
      const lines = [
        "Consistency > intensity.",
        "Small steps, steady wins.",
        "Show up for 25 minutes.",
        "Progress beats perfection.",
        "One chapter at a time.",
        "Momentum is built daily.",
      ];
      const dt = Utils.dateFromKey(dateKey) || new Date();
      const dayIndex = Math.floor((dt - new Date(dt.getFullYear(), 0, 0)) / Utils.DAY_MS);
      return lines[dayIndex % lines.length];
    },

    getHeatmap(state, days = 60) {
      const now = new Date();
      const start = Utils.startOfLocalDay(now).getTime();
      const cells = [];
      for (let i = days - 1; i >= 0; i--) {
        const key = Utils.toDateKey(new Date(start - i * Utils.DAY_MS));
        const d = Engine.getDaily(state, key);
        const minutes = d.focusSeconds / 60;
        const chapters = d.completedChapters;
        const sessions = d.focusSessions;
        const activity = minutes / 25 + chapters * 0.9 + sessions * 0.35;
        let level = 0;
        if (activity > 0 && activity < 0.6) level = 1;
        else if (activity < 1.2) level = 2;
        else if (activity < 2.2) level = 3;
        else if (activity >= 2.2) level = 4;
        cells.push({ dateKey: key, level, minutes: Math.round(minutes), chapters, sessions });
      }
      return cells;
    },

    estimateStorageBytes(state) {
      try {
        const s = JSON.stringify(state);
        return new Blob([s]).size;
      } catch {
        return null;
      }
    },
  };

  const Store = {
    state: null,
    listeners: new Set(),

    defaults() {
      const nowIso = new Date().toISOString();
      return {
        version: 1,
        createdAt: nowIso,
        updatedAt: nowIso,
        subjects: [],
        exams: [],
        focus: {
          settings: {
            minutes: 25,
            ambientEnabled: false,
            ambientPreset: "rain",
            volume: 0.35,
            breakEnabled: true,
            breakMinutes: 5,
            lockEnabled: false,
          },
          assets: {},
          history: [],
        },
        analytics: { daily: {}, logs: [], reflections: {} },
        streak: { current: 0, longest: 0, lastActiveDate: null },
        ui: {
          route: "dashboard",
          theme: "default",
          preset: "balanced",
          devMode: false,
          heatmapDays: 60,
          missedNoticeDate: null,
          lastMilestone: null,
          lastMilestoneToast: null,
        },
        gamification: { xp: 0, level: 1 },
      };
    },

    load() {
      const base = Store.defaults();
      let raw = null;
      try {
        raw = localStorage.getItem(Utils.STORAGE_KEY);
      } catch {
        raw = null;
      }

      if (!raw) {
        Store.state = Engine.normalizeState(null, base);
        Store.save();
        return;
      }

      const parsed = Utils.safeJsonParse(raw);
      if (!parsed.ok) {
        Store.state = Engine.normalizeState(null, base);
        Store.save();
        return;
      }

      Store.state = Engine.normalizeState(parsed.value, base);
      Store.save();
    },

    save() {
      if (!Store.state) return;
      Store.state.updatedAt = new Date().toISOString();
      try {
        localStorage.setItem(Utils.STORAGE_KEY, JSON.stringify(Store.state));
      } catch (err) {
        console.warn("Failed to persist state:", err);
      }
    },

    subscribe(listener) {
      Store.listeners.add(listener);
      return () => Store.listeners.delete(listener);
    },

    emit(meta) {
      for (const fn of Store.listeners) {
        try {
          fn(Store.state, meta || {});
        } catch (err) {
          console.warn("Store listener error:", err);
        }
      }
    },

    update(mutator, meta) {
      if (!Store.state) Store.load();
      try {
        mutator(Store.state);
        Engine.ensureStreakCurrent(Store.state);
        Store.save();
        Store.emit(meta);
      } catch (err) {
        console.warn("State update failed:", err);
        Store.emit({ ...(meta || {}), error: err });
      }
    },

    _pushLog(state, entry) {
      const list = state.analytics.logs;
      const now = Date.now();
      list.push({
        id: Utils.uid("log"),
        timestamp: now,
        dateKey: Utils.toDateKey(new Date(now)),
        ...entry,
      });
      state.analytics.logs = list.slice(-600);
    },

    _awardXp(state, amount) {
      const xp = Math.max(0, Number(state.gamification.xp) || 0) + Math.max(0, Number(amount) || 0);
      state.gamification.xp = xp;
      state.gamification.level = Math.max(1, Math.floor(xp / 100) + 1);
    },

    _applyActivity(state, delta, dateKey) {
      const key = dateKey || Utils.toDateKey(new Date());
      const daily = state.analytics.daily;
      const curr = daily[key] && typeof daily[key] === "object" ? daily[key] : {};
      daily[key] = {
        focusSeconds: Math.max(0, Number(curr.focusSeconds) || 0) + Math.max(0, Number(delta.focusSeconds) || 0),
        focusSessions: Math.max(0, Number(curr.focusSessions) || 0) + Math.max(0, Number(delta.focusSessions) || 0),
        completedChapters:
          Math.max(0, Number(curr.completedChapters) || 0) + Math.max(0, Number(delta.completedChapters) || 0),
      };
      Engine.updateStreakOnActivity(state, key);
      const milestones = [3, 7, 14, 30, 60, 100];
      if (milestones.includes(state.streak.current) && state.ui.lastMilestone !== state.streak.current) {
        state.ui.lastMilestone = state.streak.current;
      }
    },

    logActivity(delta, dateKey) {
      Store.update((s) => Store._applyActivity(s, delta, dateKey), { type: "activity.log" });
    },

    saveReflection(text, dateKey) {
      const key = dateKey || Utils.toDateKey(new Date());
      let cleared = false;
      Store.update(
        (s) => {
          if (!s.analytics.reflections || typeof s.analytics.reflections !== "object") s.analytics.reflections = {};
          const clean = String(text || "")
            .trim()
            .replace(/\s+/g, " ");
          if (!clean) {
            delete s.analytics.reflections[key];
            cleared = true;
            return;
          }
          s.analytics.reflections[key] = clean.slice(0, 240);
          Store._pushLog(s, {
            type: "reflection.save",
            label: `Reflection • ${clean.slice(0, 42)}`,
          });
        },
        { type: "reflection.save", dateKey: key },
      );
      return cleared;
    },

    addSubject({ name, color, weight }) {
      const clean = String(name || "").trim();
      if (!clean) throw new Error("Subject name is required.");
      const c = typeof color === "string" && color ? color : Utils.COLORS[0];
      const subject = {
        id: Utils.uid("sub"),
        name: clean.slice(0, 60),
        color: c,
        createdAt: new Date().toISOString(),
        weight: Utils.clamp(Number(weight ?? 1), 1, 3),
        collapsed: false,
        chapters: [],
      };
      Store.update((s) => s.subjects.push(subject), { type: "subject.add", subjectId: subject.id });
      return subject;
    },

    deleteSubject(subjectId) {
      Store.update(
        (s) => {
          s.subjects = s.subjects.filter((sub) => sub.id !== subjectId);
          s.exams = s.exams.filter((ex) => ex.subjectId !== subjectId);
        },
        { type: "subject.delete", subjectId },
      );
    },

    addChapter(subjectId, { title, difficulty }) {
      const clean = String(title || "").trim();
      if (!clean) throw new Error("Chapter title is required.");
      const diff = Utils.clamp(Number(difficulty) || 2, 1, 3);
      const chapter = {
        id: Utils.uid("ch"),
        title: clean.slice(0, 120),
        difficulty: diff,
        createdAt: new Date().toISOString(),
        completedAt: null,
        skipCount: 0,
        completeCount: 0,
        boost: 0,
        lastSkippedAt: null,
        lastCompletedAt: null,
      };
      Store.update(
        (s) => {
          const subject = Engine.getSubject(s, subjectId);
          if (!subject) throw new Error("Subject not found.");
          subject.chapters.push(chapter);
        },
        { type: "chapter.add", subjectId, chapterId: chapter.id },
      );
      return chapter;
    },

    setChapterCompleted(subjectId, chapterId, completed) {
      const next = Boolean(completed);
      Store.update(
        (s) => {
          const found = Engine.getChapter(s, subjectId, chapterId);
          if (!found) throw new Error("Chapter not found.");
          const { chapter } = found;
          const was = Boolean(chapter.completedAt);
          if (next && !was) {
            const nowIso = new Date().toISOString();
            chapter.completedAt = nowIso;
            chapter.lastCompletedAt = nowIso;
            chapter.completeCount = Math.max(0, Number(chapter.completeCount) || 0) + 1;
            const createdAt = chapter.createdAt ? new Date(chapter.createdAt) : new Date(nowIso);
            const quick = nowIso ? new Date(nowIso) - createdAt < Utils.DAY_MS : false;
            const boostDelta = quick ? 2 : 1;
            chapter.boost = Utils.clamp(Number(chapter.boost || 0) + boostDelta, -12, 12);
            Store._applyActivity(s, { completedChapters: 1 }, Utils.toDateKey(new Date(nowIso)));
            Store._pushLog(s, {
              type: "chapter.complete",
              label: `${found.subject.name} • ${chapter.title}`,
              subjectId,
              chapterId,
            });
            Store._awardXp(s, 10);
          } else if (!next && was) {
            chapter.completedAt = null;
          }
        },
        { type: "chapter.complete", subjectId, chapterId, completed: next },
      );
    },

    deleteChapter(subjectId, chapterId) {
      Store.update(
        (s) => {
          const subject = Engine.getSubject(s, subjectId);
          if (!subject) throw new Error("Subject not found.");
          subject.chapters = subject.chapters.filter((c) => c.id !== chapterId);
        },
        { type: "chapter.delete", subjectId, chapterId },
      );
    },

    snoozeChapter(subjectId, chapterId) {
      Store.update(
        (s) => {
          const found = Engine.getChapter(s, subjectId, chapterId);
          if (!found) throw new Error("Chapter not found.");
          const { chapter } = found;
          chapter.skipCount = Math.max(0, Number(chapter.skipCount) || 0) + 1;
          chapter.boost = Utils.clamp(Number(chapter.boost || 0) - 1, -12, 12);
          chapter.lastSkippedAt = new Date().toISOString();
          Store._pushLog(s, {
            type: "chapter.skip",
            label: `${found.subject.name} • ${chapter.title}`,
            subjectId,
            chapterId,
          });
        },
        { type: "chapter.snooze", subjectId, chapterId },
      );
    },

    completeReview(subjectId, chapterId) {
      const nowIso = new Date().toISOString();
      Store.update(
        (s) => {
          const found = Engine.getChapter(s, subjectId, chapterId);
          if (!found) throw new Error("Chapter not found.");
          found.chapter.lastCompletedAt = nowIso;
          found.chapter.boost = Utils.clamp(Number(found.chapter.boost || 0) + 1, -12, 12);
          Store._pushLog(s, {
            type: "review.complete",
            label: `${found.subject.name} • ${found.chapter.title}`,
            subjectId,
            chapterId,
          });
          Store._applyActivity(s, { focusSeconds: 0, focusSessions: 0, completedChapters: 0 });
          Store._awardXp(s, 5);
        },
        { type: "review.complete", subjectId, chapterId },
      );
    },

    setSubjectWeight(subjectId, weight) {
      Store.update(
        (s) => {
          const subject = Engine.getSubject(s, subjectId);
          if (!subject) throw new Error("Subject not found.");
          subject.weight = Utils.clamp(Number(weight) || 1, 1, 3);
        },
        { type: "subject.weight", subjectId },
      );
    },

    toggleSubjectCollapse(subjectId) {
      Store.update(
        (s) => {
          const subject = Engine.getSubject(s, subjectId);
          if (!subject) throw new Error("Subject not found.");
          subject.collapsed = !subject.collapsed;
        },
        { type: "subject.toggle", subjectId },
      );
    },

    addExam({ title, dateKey, subjectId }) {
      const clean = String(title || "").trim();
      if (!clean) throw new Error("Exam title is required.");
      const dt = Utils.dateFromKey(dateKey);
      if (!dt) throw new Error("Valid exam date is required.");
      const exam = {
        id: Utils.uid("ex"),
        title: clean.slice(0, 120),
        dateKey: Utils.toDateKey(dt),
        subjectId: subjectId || null,
        createdAt: new Date().toISOString(),
      };
      Store.update((s) => s.exams.push(exam), { type: "exam.add", examId: exam.id });
      return exam;
    },

    deleteExam(examId) {
      Store.update((s) => (s.exams = s.exams.filter((e) => e.id !== examId)), { type: "exam.delete", examId });
    },

    setFocusSettings(partial) {
      Store.update(
        (s) => {
          const set = s.focus.settings;
          if (Object.hasOwn(partial, "ambientEnabled")) set.ambientEnabled = Boolean(partial.ambientEnabled);
          if (Object.hasOwn(partial, "ambientPreset")) {
            const p = String(partial.ambientPreset);
            if (["rain", "waves", "brown", "fan", "library", "white"].includes(p)) set.ambientPreset = p;
          }
          if (Object.hasOwn(partial, "volume")) set.volume = Utils.clamp(Number(partial.volume), 0, 1);
          if (Object.hasOwn(partial, "minutes")) set.minutes = Utils.clamp(Number(partial.minutes), 10, 90);
          if (Object.hasOwn(partial, "breakEnabled")) set.breakEnabled = Boolean(partial.breakEnabled);
          if (Object.hasOwn(partial, "breakMinutes")) set.breakMinutes = Utils.clamp(Number(partial.breakMinutes), 1, 20);
          if (Object.hasOwn(partial, "lockEnabled")) set.lockEnabled = Boolean(partial.lockEnabled);
        },
        { type: "focus.settings" },
      );
    },

    completeFocusSession(task, durationSec, startedAtIso, endedAtIso) {
      const nowIso = new Date().toISOString();
      const startedAt = typeof startedAtIso === "string" ? startedAtIso : nowIso;
      const endedAt = typeof endedAtIso === "string" ? endedAtIso : nowIso;
      const dateKey = Utils.toDateKey(new Date(endedAt));
      const settings = Store.state.focus.settings;
      const session = {
        id: Utils.uid("fs"),
        startedAt,
        endedAt,
        durationSec: Math.max(0, Math.floor(Number(durationSec) || 0)),
        completed: true,
        task: {
          subjectId: task.subjectId,
          chapterId: task.chapterId,
          label: `${task.subjectName} • ${task.title}`,
          difficulty: task.difficulty,
        },
        ambient: {
          enabled: Boolean(settings.ambientEnabled),
          preset: settings.ambientPreset,
          volume: settings.volume,
        },
        createdAt: endedAt,
      };

      Store.update(
        (s) => {
          s.focus.history.push(session);
          s.focus.history = s.focus.history.slice(-600);
          Store._applyActivity(s, { focusSeconds: session.durationSec, focusSessions: 1 }, dateKey);
          Store._pushLog(s, {
            type: "focus.complete",
            label: session.task.label,
            subjectId: task.subjectId,
            chapterId: task.chapterId,
            durationSec: session.durationSec,
          });
          Store._awardXp(s, 25);

          const found = Engine.getChapter(s, task.subjectId, task.chapterId);
          if (found && !found.chapter.completedAt) {
            found.chapter.completedAt = endedAt;
            found.chapter.lastCompletedAt = endedAt;
            found.chapter.completeCount = Math.max(0, Number(found.chapter.completeCount) || 0) + 1;
            found.chapter.boost = Utils.clamp(Number(found.chapter.boost || 0) + 1, -12, 12);
            Store._applyActivity(s, { completedChapters: 1 }, dateKey);
            Store._pushLog(s, {
              type: "chapter.complete",
              label: `${found.subject.name} • ${found.chapter.title}`,
              subjectId: task.subjectId,
              chapterId: task.chapterId,
            });
            Store._awardXp(s, 10);
          }
        },
        { type: "focus.session", sessionId: session.id },
      );

      return session;
    },

    exportJson() {
      return JSON.stringify(Store.state, null, 2);
    },

    exportStats() {
      const s = Store.state;
      const focusSummary = Engine.getFocusSummary(s);
      const focusStats = Engine.getFocusStats(s);
      const progress = Engine.getProgress(s);
      const stats = {
        generatedAt: new Date().toISOString(),
        streak: s.streak,
        focusMinutesToday: Math.round(focusSummary.today.focusSeconds / 60),
        focusMinutes7d: Math.round(focusSummary.last7.focusSeconds / 60),
        focusMinutesAll: Math.round(focusSummary.totalFocusSeconds / 60),
        averageSessionMinutes: Math.round(focusStats.averageSessionSec / 60),
        mostFocusedSubject: focusStats.mostFocusedSubject,
        progressPercent: progress.pct,
        completedChapters: progress.done,
        totalChapters: progress.total,
        xp: s.gamification.xp,
        level: s.gamification.level,
      };
      return JSON.stringify(stats, null, 2);
    },

    importJson(text) {
      const parsed = Utils.safeJsonParse(text);
      if (!parsed.ok) throw new Error("Invalid JSON.");
      Store.state = Engine.normalizeState(parsed.value, Store.defaults());
      Store.save();
      Store.emit({ type: "data.import" });
    },

    hardReset() {
      try {
        localStorage.removeItem(Utils.STORAGE_KEY);
      } catch {}
      Store.state = Engine.normalizeState(null, Store.defaults());
      Store.save();
      Store.emit({ type: "data.reset" });
    },

    resetAnalytics() {
      Store.update(
        (s) => {
          s.analytics.daily = {};
          s.analytics.logs = [];
          s.analytics.reflections = {};
          s.focus.history = [];
          s.streak = { current: 0, longest: s.streak.longest || 0, lastActiveDate: null };
          s.gamification = { xp: 0, level: 1 };
        },
        { type: "data.reset.analytics" },
      );
    },

    resetTasks() {
      Store.update(
        (s) => {
          s.subjects = [];
          s.exams = [];
          s.focus.history = [];
        },
        { type: "data.reset.tasks" },
      );
    },
  };

  const AudioEngine = {
    ctx: null,
    gain: null,
    source: null,
    filter: null,
    lfo: null,
    audioEl: null,
    enabled: false,

    ensure() {
      if (AudioEngine.ctx) return;
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) throw new Error("Audio not supported");
      AudioEngine.ctx = new Ctx();
      AudioEngine.gain = AudioEngine.ctx.createGain();
      AudioEngine.gain.gain.value = Store.state.focus.settings.volume;
      AudioEngine.gain.connect(AudioEngine.ctx.destination);
    },

    makeNoiseBuffer(kind = "white", seconds = 2) {
      const ctx = AudioEngine.ctx;
      const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
      const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        if (kind === "brown") {
          last = (last + 0.02 * white) / 1.02;
          data[i] = last * 3.5;
        } else {
          data[i] = white;
        }
      }
      return buffer;
    },

    stop() {
      try {
        if (AudioEngine.source) AudioEngine.source.stop();
      } catch {}
      try {
        if (AudioEngine.source) AudioEngine.source.disconnect();
      } catch {}
      try {
        if (AudioEngine.filter) AudioEngine.filter.disconnect();
      } catch {}
      try {
        if (AudioEngine.lfo) AudioEngine.lfo.stop();
      } catch {}
      try {
        if (AudioEngine.audioEl) {
          AudioEngine.audioEl.pause();
          AudioEngine.audioEl.currentTime = 0;
        }
      } catch {}
      AudioEngine.source = null;
      AudioEngine.filter = null;
      AudioEngine.lfo = null;
      AudioEngine.enabled = false;
    },

    setVolume(volume) {
      if (AudioEngine.gain) AudioEngine.gain.gain.value = Utils.clamp(Number(volume), 0, 1);
      if (AudioEngine.audioEl) AudioEngine.audioEl.volume = Utils.clamp(Number(volume), 0, 1);
    },

    playFile(src, volume) {
      return new Promise((resolve) => {
        try {
          if (!AudioEngine.audioEl) {
            AudioEngine.audioEl = new Audio();
            AudioEngine.audioEl.loop = true;
            AudioEngine.audioEl.preload = "auto";
          }
          AudioEngine.audioEl.oncanplay = async () => {
            try {
              AudioEngine.audioEl.volume = Utils.clamp(Number(volume), 0, 1);
              await AudioEngine.audioEl.play();
              resolve(true);
            } catch {
              resolve(false);
            }
          };
          AudioEngine.audioEl.onerror = () => resolve(false);
          AudioEngine.audioEl.src = src;
          AudioEngine.audioEl.load();
        } catch {
          resolve(false);
        }
      });
    },

    buildChain(preset) {
      const ctx = AudioEngine.ctx;
      const src = ctx.createBufferSource();
      src.loop = true;
      src.buffer = preset === "brown" ? AudioEngine.makeNoiseBuffer("brown", 3) : AudioEngine.makeNoiseBuffer("white", 2);

      const filter = ctx.createBiquadFilter();
      if (preset === "rain") {
        filter.type = "highpass";
        filter.frequency.value = 800;
        filter.Q.value = 0.8;
      } else if (preset === "waves") {
        filter.type = "lowpass";
        filter.frequency.value = 700;
        filter.Q.value = 0.7;
      } else if (preset === "fan") {
        filter.type = "lowpass";
        filter.frequency.value = 500;
        filter.Q.value = 0.5;
      } else if (preset === "library") {
        filter.type = "bandpass";
        filter.frequency.value = 1000;
        filter.Q.value = 0.9;
      } else if (preset === "white") {
        filter.type = "lowpass";
        filter.frequency.value = 12000;
        filter.Q.value = 0.3;
      } else {
        filter.type = "lowpass";
        filter.frequency.value = 900;
        filter.Q.value = 0.6;
      }

      src.connect(filter);
      filter.connect(AudioEngine.gain);

      let lfo = null;
      if (preset === "waves") {
        lfo = ctx.createOscillator();
        const lfoGain = ctx.createGain();
        lfo.type = "sine";
        lfo.frequency.value = 0.08;
        lfoGain.gain.value = 0.22;
        lfo.connect(lfoGain);
        lfoGain.connect(AudioEngine.gain.gain);
        lfo.start();
      }

      AudioEngine.source = src;
      AudioEngine.filter = filter;
      AudioEngine.lfo = lfo;
    },

    async start() {
      const settings = Store.state.focus.settings;
      if (!settings.ambientEnabled) return;
      AudioEngine.stop();
      const preset = settings.ambientPreset;
      const asset = Store.state.focus.assets?.[preset] || "";
      let played = false;
      if (asset) {
        played = await AudioEngine.playFile(asset, settings.volume);
      }
      if (!played) {
        played = await AudioEngine.playFile(`ambient/${preset}.mp3`, settings.volume);
      }
      if (played) {
        AudioEngine.enabled = true;
        return;
      }
      AudioEngine.ensure();
      await AudioEngine.ctx.resume();
      AudioEngine.setVolume(settings.volume);
      AudioEngine.buildChain(settings.ambientPreset);
      AudioEngine.source.start();
      AudioEngine.enabled = true;
    },
  };

  const FocusMode = {
    open: false,
    running: false,
    interval: null,
    breakInterval: null,
    task: null,
    totalSec: 25 * 60,
    remainingSec: 25 * 60,
    endTimeMs: null,
    startedAtIso: null,
    lockUntilMs: null,
    breakRemainingSec: 0,
    breakEndMs: null,
    tickMs: 240,
    els: {},
    breakEls: {},

    init() {
      FocusMode.els = {
        overlay: document.getElementById("focusOverlay"),
        ring: document.getElementById("focusRing"),
        title: document.getElementById("focusTitle"),
        meta: document.getElementById("focusMeta"),
        time: document.getElementById("focusTime"),
        status: document.getElementById("focusStatus"),
        footer: document.getElementById("focusFooter"),
        ambientToggle: document.getElementById("ambientToggle"),
        ambientPreset: document.getElementById("ambientPreset"),
        ambientVolume: document.getElementById("ambientVolume"),
        breakToggle: document.getElementById("breakToggle"),
        lockToggle: document.getElementById("lockToggle"),
        focusDuration: document.getElementById("focusDuration"),
      };

      FocusMode.breakEls = {
        overlay: document.getElementById("breakOverlay"),
        time: document.getElementById("breakTime"),
        status: document.getElementById("breakStatus"),
        guide: document.getElementById("breakGuide"),
        meta: document.getElementById("breakMeta"),
      };

      FocusMode.totalSec = Utils.clamp(Number(Store.state.focus.settings.minutes || 25), 10, 90) * 60;
      FocusMode.resetInternal();
      FocusMode.syncAmbientUI();
    },

    syncAmbientUI() {
      const s = Store.state.focus.settings;
      if (FocusMode.els.ambientToggle) FocusMode.els.ambientToggle.checked = Boolean(s.ambientEnabled);
      if (FocusMode.els.ambientPreset) FocusMode.els.ambientPreset.value = s.ambientPreset || "rain";
      if (FocusMode.els.ambientVolume)
        FocusMode.els.ambientVolume.value = String(Math.round((s.volume ?? 0.35) * 100));
      if (FocusMode.els.breakToggle) FocusMode.els.breakToggle.checked = Boolean(s.breakEnabled);
      if (FocusMode.els.lockToggle) FocusMode.els.lockToggle.checked = Boolean(s.lockEnabled);
      if (FocusMode.els.focusDuration) FocusMode.els.focusDuration.value = String(s.minutes || 25);
    },

    clearTick() {
      if (FocusMode.interval) clearInterval(FocusMode.interval);
      FocusMode.interval = null;
    },

    clearBreak() {
      if (FocusMode.breakInterval) clearInterval(FocusMode.breakInterval);
      FocusMode.breakInterval = null;
      FocusMode.breakEndMs = null;
      FocusMode.breakRemainingSec = 0;
    },

    resetInternal() {
      FocusMode.totalSec = Utils.clamp(Number(Store.state.focus.settings.minutes || 25), 10, 90) * 60;
      FocusMode.running = false;
      FocusMode.remainingSec = FocusMode.totalSec;
      FocusMode.endTimeMs = null;
      FocusMode.startedAtIso = null;
      FocusMode.lockUntilMs = null;
      FocusMode.clearTick();
      FocusMode.clearBreak();
      FocusMode.updateUi();
    },

    setTask(task) {
      FocusMode.task = task;
      FocusMode.resetInternal();
    },

    show(task) {
      if (!task) throw new Error("Choose a task to focus on.");
      FocusMode.open = true;
      FocusMode.setTask(task);
      FocusMode.els.overlay.classList.remove("hidden");
      FocusMode.updateUi();
      FocusMode.els.overlay.querySelector("[data-action='focus.start']")?.focus();
    },

    hide() {
      if (FocusMode.isLocked()) {
        App.toast("Focus lock active", "You can exit after 10 minutes.", "danger");
        return;
      }
      FocusMode.open = false;
      FocusMode.clearTick();
      AudioEngine.stop();
      FocusMode.els.overlay.classList.add("hidden");
      if (document.fullscreenElement) {
        try {
          document.exitFullscreen();
        } catch {}
      }
    },

    isLocked() {
      return (
        Store.state.focus.settings.lockEnabled &&
        FocusMode.lockUntilMs &&
        Date.now() < FocusMode.lockUntilMs
      );
    },

    async maybeStartAmbient() {
      if (!Store.state.focus.settings.ambientEnabled) return;
      try {
        await AudioEngine.start();
      } catch (err) {
        console.warn(err);
        App.toast("Audio blocked", "Turn on audio after a click/tap.", "danger");
      }
    },

    start() {
      if (!FocusMode.task || FocusMode.running) return;
      if (!FocusMode.startedAtIso) FocusMode.startedAtIso = new Date().toISOString();
      if (Store.state.focus.settings.lockEnabled && !FocusMode.lockUntilMs) {
        FocusMode.lockUntilMs = Date.now() + 10 * 60 * 1000;
      }
      FocusMode.running = true;
      FocusMode.endTimeMs = Date.now() + FocusMode.remainingSec * 1000;
      FocusMode.clearTick();
      FocusMode.interval = setInterval(FocusMode.onTick, FocusMode.tickMs);
      FocusMode.onTick();
      FocusMode.maybeStartAmbient();
      FocusMode.updateUi();
    },

    pause() {
      if (!FocusMode.running) return;
      FocusMode.onTick();
      FocusMode.running = false;
      FocusMode.endTimeMs = null;
      FocusMode.clearTick();
      FocusMode.updateUi();
    },

    resume() {
      if (!FocusMode.task || FocusMode.running || FocusMode.remainingSec <= 0) return;
      if (Store.state.focus.settings.lockEnabled && !FocusMode.lockUntilMs) {
        FocusMode.lockUntilMs = Date.now() + 10 * 60 * 1000;
      }
      FocusMode.running = true;
      FocusMode.endTimeMs = Date.now() + FocusMode.remainingSec * 1000;
      FocusMode.clearTick();
      FocusMode.interval = setInterval(FocusMode.onTick, FocusMode.tickMs);
      FocusMode.onTick();
      FocusMode.maybeStartAmbient();
      FocusMode.updateUi();
    },

    reset() {
      FocusMode.resetInternal();
    },

    onTick() {
      if (!FocusMode.running || !FocusMode.endTimeMs) return;
      const msLeft = FocusMode.endTimeMs - Date.now();
      FocusMode.remainingSec = Math.max(0, Math.ceil(msLeft / 1000));
      FocusMode.updateUi();
      if (FocusMode.remainingSec <= 0) FocusMode.complete();
    },

    complete() {
      if (!FocusMode.task) return;
      FocusMode.clearTick();
      FocusMode.running = false;
      FocusMode.remainingSec = 0;
      FocusMode.endTimeMs = null;
      const endedAtIso = new Date().toISOString();
      AudioEngine.stop();

      Store.completeFocusSession(FocusMode.task, FocusMode.totalSec, FocusMode.startedAtIso, endedAtIso);
      if (FocusMode.task.type === "review") {
        Store.completeReview(FocusMode.task.subjectId, FocusMode.task.chapterId);
      }
      const doneMsg = FocusMode.task.type === "review" ? "Review logged." : "Task marked done.";
      App.toast("Session complete", doneMsg, "ok");
      App.confetti();
      if (Store.state.focus.settings.breakEnabled) {
        FocusMode.startBreak();
      }
      FocusMode.updateUi();
    },

    startBreak() {
      if (!FocusMode.breakEls.overlay) return;
      FocusMode.clearBreak();
      const minutes = Utils.clamp(Number(Store.state.focus.settings.breakMinutes || 5), 1, 20);
      FocusMode.breakRemainingSec = minutes * 60;
      FocusMode.breakEndMs = Date.now() + FocusMode.breakRemainingSec * 1000;
      FocusMode.breakEls.meta.textContent = `${minutes} minute break • Stretch + reset`;
      FocusMode.breakEls.overlay.classList.remove("hidden");
      FocusMode.updateBreakUi();
      FocusMode.breakInterval = setInterval(() => FocusMode.onBreakTick(), 500);
    },

    endBreak() {
      FocusMode.clearBreak();
      if (FocusMode.breakEls.overlay) FocusMode.breakEls.overlay.classList.add("hidden");
      App.toast("Break done", "Ready when you are.", "ok");
    },

    onBreakTick() {
      if (!FocusMode.breakEndMs) return;
      const msLeft = FocusMode.breakEndMs - Date.now();
      FocusMode.breakRemainingSec = Math.max(0, Math.ceil(msLeft / 1000));
      FocusMode.updateBreakUi();
      if (FocusMode.breakRemainingSec <= 0) FocusMode.endBreak();
    },

    updateBreakUi() {
      if (!FocusMode.breakEls.time) return;
      FocusMode.breakEls.time.textContent = Utils.formatTimer(FocusMode.breakRemainingSec);
      const total = Math.max(1, (Store.state.focus.settings.breakMinutes || 5) * 60);
      const elapsed = total - FocusMode.breakRemainingSec;
      const phase = Math.floor((elapsed % 16) / 4);
      const phases = ["Breathe in…", "Hold…", "Breathe out…", "Hold…"];
      FocusMode.breakEls.status.textContent = phases[phase] || "Breathe…";
      FocusMode.breakEls.guide.textContent = "Relax your shoulders. Slow, steady breathing.";
    },

    async toggleFullscreen() {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await FocusMode.els.overlay.requestFullscreen();
      } catch (err) {
        console.warn(err);
        App.toast("Fullscreen unavailable", "Your browser blocked fullscreen.", "danger");
      }
    },

    updateUi() {
      if (!FocusMode.els.time) return;
      const task = FocusMode.task;
      FocusMode.els.title.textContent = task ? task.title : "Pick a task";
      FocusMode.els.meta.textContent = task
        ? `${task.subjectName} • ${Engine.difficultyLabel(task.difficulty).label}${
            task.exam ? ` • ${Utils.formatDaysLeft(task.exam.daysLeft)} (${task.exam.title})` : ""
          }`
        : "";

      FocusMode.els.time.textContent = Utils.formatTimer(FocusMode.remainingSec);
      let status = "Ready";
      if (FocusMode.running) status = "Focusing";
      else if (FocusMode.remainingSec === 0 && FocusMode.startedAtIso) status = "Done";
      else if (FocusMode.startedAtIso && FocusMode.remainingSec > 0) status = "Paused";
      FocusMode.els.status.textContent = status;

      const progress = 1 - FocusMode.remainingSec / Math.max(1, FocusMode.totalSec);
      FocusMode.els.ring.style.setProperty("--progress", String(Utils.clamp(progress, 0, 1)));
      FocusMode.els.ring.classList.toggle("is-running", FocusMode.running);

      const startBtn = FocusMode.els.overlay.querySelector("[data-action='focus.start']");
      const pauseBtn = FocusMode.els.overlay.querySelector("[data-action='focus.pause']");
      const resumeBtn = FocusMode.els.overlay.querySelector("[data-action='focus.resume']");
      const resetBtn = FocusMode.els.overlay.querySelector("[data-action='focus.reset']");
      const closeBtn = FocusMode.els.overlay.querySelector("[data-action='focus.close']");

      const hasTask = Boolean(task);
      if (startBtn) startBtn.disabled = !hasTask || FocusMode.running || FocusMode.remainingSec !== FocusMode.totalSec;
      if (pauseBtn) pauseBtn.disabled = !FocusMode.running;
      if (resumeBtn)
        resumeBtn.disabled =
          !hasTask || FocusMode.running || FocusMode.remainingSec <= 0 || FocusMode.remainingSec === FocusMode.totalSec;
      if (resetBtn) resetBtn.disabled = FocusMode.running;
      if (closeBtn) closeBtn.disabled = FocusMode.isLocked();

      const doneLine = FocusMode.task?.type === "review" ? "Completion logs the review." : "Completion marks the task done.";
      const footerBits = [doneLine];
      if (Store.state.focus.settings.breakEnabled) footerBits.unshift("Smart break enabled.");
      if (Store.state.focus.settings.lockEnabled) footerBits.unshift("Focus lock active.");
      FocusMode.els.footer.textContent = `${Store.state.focus.settings.minutes} min session. ${footerBits.join(" ")}`;
    },
  };

  const App = {
    els: {},
    deferredInstallPrompt: null,

    init() {
      Store.load();
      App.applyTheme();

      App.els = {
        view: document.getElementById("view"),
        viewTitle: document.getElementById("viewTitle"),
        viewSubtitle: document.getElementById("viewSubtitle"),
        topbarActions: document.getElementById("topbarActions"),
        nav: document.getElementById("nav"),
        sidebar: document.getElementById("sidebar"),
        modalOverlay: document.getElementById("modalOverlay"),
        modalTitle: document.getElementById("modalTitle"),
        modalBody: document.getElementById("modalBody"),
        toastHost: document.getElementById("toastHost"),
        storageStatus: document.getElementById("storageStatus"),
        offlineStatus: document.getElementById("offlineStatus"),
        installBtn: document.getElementById("installBtn"),
        panicToggle: document.getElementById("panicToggle"),
        panicOverlay: document.getElementById("panicOverlay"),
        panicBody: document.getElementById("panicBody"),
        panicMeta: document.getElementById("panicMeta"),
        importFile: document.getElementById("importFile"),
        ambientFile: document.getElementById("ambientFile"),
      };
      App.pendingAmbientPreset = null;

      FocusMode.init();

      if (!location.hash) location.hash = "#dashboard";

      window.addEventListener("hashchange", () => App.render());
      window.addEventListener("online", () => App.updateConnectivity());
      window.addEventListener("offline", () => App.updateConnectivity());

      document.addEventListener("click", App.onClick);
      document.addEventListener("submit", App.onSubmit);
      document.addEventListener("change", App.onChange);
      document.addEventListener("keydown", App.onKeyDown);

      App.els.modalOverlay.addEventListener("click", (e) => {
        if (e.target === App.els.modalOverlay) App.hideModal();
      });

      App.els.panicOverlay.addEventListener("click", (e) => {
        if (e.target === App.els.panicOverlay) App.closePanic();
      });

      App.els.panicToggle.addEventListener("click", () => App.openPanic());

      Store.subscribe(() => App.render());

      App.setupInstallPrompt();
      App.registerServiceWorker();
      App.updateConnectivity();
      App.render();
    },

    route() {
      const raw = String(location.hash || "").replace(/^#/, "");
      const allowed = new Set(["dashboard", "subjects", "exams", "focus", "analytics", "data"]);
      return allowed.has(raw) ? raw : "dashboard";
    },

    setRoute(route) {
      location.hash = `#${route}`;
      document.body.classList.remove("sidebar-open");
    },

    onKeyDown(e) {
      if (e.key === "Escape") {
        if (!App.els.modalOverlay.classList.contains("hidden")) App.hideModal();
        else if (!App.els.panicOverlay.classList.contains("hidden")) App.closePanic();
        else if (!FocusMode.els.overlay.classList.contains("hidden")) FocusMode.hide();
      }
      if ((e.key === "p" || e.key === "P") && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        App.openPanic();
      }
    },

    onClick(e) {
      if (document.body.classList.contains("sidebar-open")) {
        const menuBtn = e.target.closest("[data-action='ui.sidebarToggle']");
        if (!menuBtn && App.els.sidebar && !App.els.sidebar.contains(e.target)) {
          document.body.classList.remove("sidebar-open");
        }
      }

      const routeBtn = e.target.closest("[data-route]");
      if (routeBtn) {
        App.setRoute(routeBtn.getAttribute("data-route"));
        return;
      }

      const actionEl = e.target.closest("[data-action]");
      if (!actionEl) return;
      const action = actionEl.getAttribute("data-action");
      if (!action) return;

      try {
        if (action === "ui.sidebarToggle") {
          document.body.classList.toggle("sidebar-open");
          return;
        }
        if (action === "modal.close") return void App.hideModal();

        if (action === "subject.add.open") return void App.openAddSubjectModal();

        if (action === "subject.delete") {
          const subjectId = actionEl.getAttribute("data-subject-id");
          const subject = Engine.getSubject(Store.state, subjectId);
          if (!subject) return;
          App.confirm({
            title: "Delete subject?",
            message: `"${subject.name}" and its chapters will be removed. Linked exams will be removed too.`,
            dangerLabel: "Delete",
            onConfirm: () => {
              Store.deleteSubject(subjectId);
              App.toast("Deleted", "Subject removed.", "danger");
            },
          });
          return;
        }

        if (action === "subject.toggle") {
          const subjectId = actionEl.getAttribute("data-subject-id");
          Store.toggleSubjectCollapse(subjectId);
          return;
        }

        if (action === "chapter.delete") {
          const subjectId = actionEl.getAttribute("data-subject-id");
          const chapterId = actionEl.getAttribute("data-chapter-id");
          const found = Engine.getChapter(Store.state, subjectId, chapterId);
          if (!found) return;
          App.confirm({
            title: "Delete chapter?",
            message: `"${found.chapter.title}" will be removed.`,
            dangerLabel: "Delete",
            onConfirm: () => {
              Store.deleteChapter(subjectId, chapterId);
              App.toast("Deleted", "Chapter removed.", "danger");
            },
          });
          return;
        }

        if (action === "chapter.snooze") {
          const subjectId = actionEl.getAttribute("data-subject-id");
          const chapterId = actionEl.getAttribute("data-chapter-id");
          Store.snoozeChapter(subjectId, chapterId);
          App.toast("Snoozed", "Task will resurface later.", "ok");
          return;
        }

        if (action === "review.complete") {
          const subjectId = actionEl.getAttribute("data-subject-id");
          const chapterId = actionEl.getAttribute("data-chapter-id");
          Store.completeReview(subjectId, chapterId);
          App.toast("Logged", "Review session saved.", "ok");
          return;
        }

        if (action === "chapter.toggle") {
          const subjectId = actionEl.getAttribute("data-subject-id");
          const chapterId = actionEl.getAttribute("data-chapter-id");
          const checked =
            actionEl instanceof HTMLInputElement ? actionEl.checked : actionEl.getAttribute("data-checked") === "1";
          Store.setChapterCompleted(subjectId, chapterId, checked);
          if (checked) App.toast("Completed", "Chapter marked done.", "ok");
          return;
        }

        if (action === "chapter.focus") {
          const subjectId = actionEl.getAttribute("data-subject-id");
          const chapterId = actionEl.getAttribute("data-chapter-id");
          const task = Engine.computeTaskCandidates(Store.state).find(
            (t) => t.subjectId === subjectId && t.chapterId === chapterId,
          );
          if (!task) return void App.toast("No task", "That chapter is already completed.", "danger");
          FocusMode.show(task);
          return;
        }

        if (action === "dashboard.recommend.focus") {
          const task = Engine.getSmartRecommendation(Store.state);
          if (!task) return void App.toast("All caught up", "No remaining chapters to focus on.", "ok");
          FocusMode.show(task);
          return;
        }

        if (action === "dashboard.recommend.done") {
          const task = Engine.getSmartRecommendation(Store.state);
          if (!task) return;
          if (task.type === "review") {
            Store.completeReview(task.subjectId, task.chapterId);
            App.toast("Logged", "Review session saved.", "ok");
          } else {
            Store.setChapterCompleted(task.subjectId, task.chapterId, true);
            App.toast("Completed", "Recommended task marked done.", "ok");
          }
          return;
        }

        if (action === "exam.add.open") return void App.openAddExamModal();

        if (action === "exam.delete") {
          const examId = actionEl.getAttribute("data-exam-id");
          const ex = Store.state.exams.find((x) => x.id === examId);
          if (!ex) return;
          App.confirm({
            title: "Delete exam?",
            message: `"${ex.title}" will be removed.`,
            dangerLabel: "Delete",
            onConfirm: () => {
              Store.deleteExam(examId);
              App.toast("Deleted", "Exam removed.", "danger");
            },
          });
          return;
        }

        if (action === "focus.open") {
          let taskId = actionEl.getAttribute("data-task-id");
          if (!taskId) {
            const sel = document.getElementById("focusTaskSelect");
            if (sel && sel.value) taskId = sel.value;
          }
          const tasks = Engine.computeTaskCandidates(Store.state);
          const task = tasks.find((t) => `${t.subjectId}:${t.chapterId}` === taskId) || tasks[0] || null;
          if (!task) return void App.toast("No tasks", "Add a subject and chapter first.", "danger");
          FocusMode.show(task);
          return;
        }

        if (action === "focus.micro") {
          const minutes = Number(actionEl.getAttribute("data-minutes") || 5);
          const task = Engine.getSmartRecommendation(Store.state);
          if (!task) return void App.toast("No tasks", "Add a subject and chapter first.", "danger");
          Store.setFocusSettings({ minutes });
          FocusMode.show(task);
          FocusMode.start();
          return;
        }

        if (action === "focus.close") return void FocusMode.hide();
        if (action === "focus.start") return void FocusMode.start();
        if (action === "focus.pause") return void FocusMode.pause();
        if (action === "focus.resume") return void FocusMode.resume();
        if (action === "focus.reset") return void FocusMode.reset();
        if (action === "focus.fullscreen") return void FocusMode.toggleFullscreen();

        if (action === "break.skip" || action === "break.end") {
          FocusMode.endBreak();
          return;
        }

        if (action === "panic.open") return void App.openPanic();
        if (action === "panic.close") return void App.closePanic();

        if (action === "panic.complete") {
          const subjectId = actionEl.getAttribute("data-subject-id");
          const chapterId = actionEl.getAttribute("data-chapter-id");
          const taskType = actionEl.getAttribute("data-task-type") || "study";
          if (subjectId && chapterId) {
            if (taskType === "review") {
              Store.completeReview(subjectId, chapterId);
              App.toast("Logged", "Review session saved.", "ok");
            } else {
              Store.setChapterCompleted(subjectId, chapterId, true);
              App.toast("Completed", "Urgent task marked done.", "ok");
            }
          }
          App.renderPanic();
          return;
        }

        if (action === "data.export") {
          const text = Store.exportJson();
          Utils.download(`steady-export-${Utils.toDateKey(new Date())}.json`, text);
          App.toast("Exported", "Your data was downloaded.", "ok");
          return;
        }

        if (action === "stats.export") {
          const text = Store.exportStats();
          Utils.download(`steady-stats-${Utils.toDateKey(new Date())}.json`, text);
          App.toast("Exported", "Stats downloaded.", "ok");
          return;
        }

        if (action === "data.import.pick") {
          App.els.importFile.value = "";
          App.els.importFile.click();
          return;
        }

        if (action === "ambient.upload") {
          const preset = actionEl.getAttribute("data-preset");
          if (!preset) return;
          App.pendingAmbientPreset = preset;
          if (App.els.ambientFile) {
            App.els.ambientFile.value = "";
            App.els.ambientFile.click();
          }
          return;
        }

        if (action === "ambient.clear") {
          const preset = actionEl.getAttribute("data-preset");
          if (!preset) return;
          Store.update(
            (s) => {
              if (!s.focus.assets) s.focus.assets = {};
              delete s.focus.assets[preset];
            },
            { type: "ambient.clear", preset },
          );
          App.toast("Cleared", `Ambient sound reset for ${preset}.`, "ok");
          return;
        }

        if (action === "data.reset") {
          App.confirm({
            title: "Hard reset?",
            message: "This will erase Steady data from this device.",
            dangerLabel: "Reset",
            onConfirm: () => {
              Store.hardReset();
              App.toast("Reset", "All local data cleared.", "danger");
              App.setRoute("dashboard");
            },
          });
          return;
        }

        if (action === "data.reset.analytics") {
          App.confirm({
            title: "Reset analytics?",
            message: "Focus history, streaks, reflections, and logs will be cleared.",
            dangerLabel: "Reset analytics",
            onConfirm: () => {
              Store.resetAnalytics();
              App.toast("Reset", "Analytics cleared.", "danger");
            },
          });
          return;
        }

        if (action === "data.reset.tasks") {
          App.confirm({
            title: "Reset tasks?",
            message: "All subjects, chapters, and exams will be removed.",
            dangerLabel: "Reset tasks",
            onConfirm: () => {
              Store.resetTasks();
              App.toast("Reset", "Tasks cleared.", "danger");
            },
          });
          return;
        }

        if (action === "theme.set") {
          const theme = actionEl.getAttribute("data-theme") || "default";
          Store.update((s) => (s.ui.theme = theme), { type: "ui.theme" });
          App.applyTheme();
          return;
        }

        if (action === "heatmap.set") {
          const days = Number(actionEl.getAttribute("data-days") || 60);
          Store.update((s) => (s.ui.heatmapDays = days), { type: "ui.heatmap" });
          return;
        }

        if (action === "install.prompt") return void App.promptInstall();
      } catch (err) {
        console.warn(err);
        App.toast("Action failed", err?.message || "Something went wrong.", "danger");
      }
    },

    async onChange(e) {
      const t = e.target;

      if (t === App.els.importFile) {
        const file = t.files && t.files[0];
        if (!file) return;
        t.value = "";
        App.confirm({
          title: "Import data?",
          message: `Importing "${file.name}" will overwrite current data on this device.`,
          dangerLabel: "Import",
          onConfirm: () => {
            (async () => {
              try {
                const text = await Utils.readFileAsText(file);
                Store.importJson(text);
                App.toast("Imported", "Your data is loaded.", "ok");
              } catch (err) {
                console.warn(err);
                App.toast("Import failed", err?.message || "Invalid file.", "danger");
              }
            })();
          },
        });
        return;
      }

      if (t === App.els.ambientFile) {
        const file = t.files && t.files[0];
        if (!file || !App.pendingAmbientPreset) return;
        const preset = App.pendingAmbientPreset;
        App.pendingAmbientPreset = null;
        t.value = "";
        try {
          const dataUrl = await Utils.readFileAsDataUrl(file);
          Store.update((s) => {
            s.focus.assets = s.focus.assets || {};
            s.focus.assets[preset] = dataUrl;
          }, { type: "ambient.upload", preset });
          App.toast("Saved", `Ambient sound set for ${preset}.`, "ok");
          if (Store.state.focus.settings.ambientPreset === preset && FocusMode.open) {
            AudioEngine.start().catch(() => {});
          }
        } catch (err) {
          console.warn(err);
          App.toast("Upload failed", err?.message || "Could not read file.", "danger");
        }
        return;
      }

      if (t && t.id === "ambientToggle") {
        Store.setFocusSettings({ ambientEnabled: t.checked });
        FocusMode.syncAmbientUI();
        if (t.checked && FocusMode.open) AudioEngine.start().catch(() => {});
        else AudioEngine.stop();
        return;
      }

      if (t && t.id === "ambientPreset") {
        Store.setFocusSettings({ ambientPreset: t.value });
        FocusMode.syncAmbientUI();
        if (Store.state.focus.settings.ambientEnabled && FocusMode.open) AudioEngine.start().catch(() => {});
        return;
      }

      if (t && t.id === "ambientVolume") {
        const v = Utils.clamp(Number(t.value) / 100, 0, 1);
        Store.setFocusSettings({ volume: v });
        AudioEngine.setVolume(v);
        return;
      }

      if (t && t.id === "breakToggle") {
        Store.setFocusSettings({ breakEnabled: t.checked });
        FocusMode.updateUi();
        return;
      }

      if (t && t.id === "lockToggle") {
        Store.setFocusSettings({ lockEnabled: t.checked });
        FocusMode.updateUi();
        return;
      }

      if (t && t.id === "focusDuration") {
        Store.setFocusSettings({ minutes: Number(t.value) });
        FocusMode.resetInternal();
        return;
      }

      if (t && t.id === "presetSelect") {
        Store.update((s) => (s.ui.preset = String(t.value || "balanced")), { type: "ui.preset" });
        return;
      }

      if (t && t.id === "devToggle") {
        Store.update((s) => (s.ui.devMode = Boolean(t.checked)), { type: "ui.dev" });
        return;
      }

      if (t && t.dataset && t.dataset.subjectId && t.dataset.field === "weight") {
        Store.setSubjectWeight(t.dataset.subjectId, t.value);
        return;
      }
    },

    onSubmit(e) {
      const form = e.target.closest("form[data-action]");
      if (!form) return;
      e.preventDefault();
      const action = form.getAttribute("data-action");
      const data = new FormData(form);

      try {
        if (action === "subject.add") {
          Store.addSubject({ name: String(data.get("name") || ""), color: String(data.get("color") || Utils.COLORS[0]) });
          App.hideModal();
          App.toast("Added", "Subject created.", "ok");
          return;
        }
        if (action === "chapter.add") {
          Store.addChapter(form.getAttribute("data-subject-id"), {
            title: String(data.get("title") || ""),
            difficulty: Number(data.get("difficulty") || 2),
          });
          form.reset();
          App.toast("Added", "Chapter created.", "ok");
          return;
        }
        if (action === "exam.add") {
          Store.addExam({
            title: String(data.get("title") || ""),
            dateKey: String(data.get("dateKey") || ""),
            subjectId: String(data.get("subjectId") || "") || null,
          });
          App.hideModal();
          App.toast("Added", "Exam created.", "ok");
          return;
        }
        if (action === "reflection.save") {
          const text = String(data.get("reflection") || "");
          const todayKey = Utils.toDateKey(new Date());
          const cleared = Store.saveReflection(text, todayKey);
          App.toast(cleared ? "Cleared" : "Saved", cleared ? "Reflection removed." : "Reflection saved.", "ok");
          return;
        }
      } catch (err) {
        console.warn(err);
        App.toast("Save failed", err?.message || "Check your input.", "danger");
      }
    },

    showModal(title, bodyHtml) {
      App.els.modalTitle.textContent = title;
      App.els.modalBody.innerHTML = bodyHtml;
      App.els.modalOverlay.classList.remove("hidden");
      App.els.modalOverlay.querySelector("input,select,textarea,button")?.focus();
    },

    hideModal() {
      App.els.modalOverlay.classList.add("hidden");
      App.els.modalBody.innerHTML = "";
    },

    confirm({ title, message, dangerLabel, onConfirm }) {
      const html = `
        <div class="stack">
          <div class="hint">${Utils.escapeHtml(message)}</div>
          <div class="formRow">
            <button class="btn btn--danger" type="button" data-action="confirm.yes">${Utils.escapeHtml(
              dangerLabel || "Confirm",
            )}</button>
            <button class="btn btn--ghost" type="button" data-action="modal.close">Cancel</button>
          </div>
        </div>
      `;
      App.showModal(title, html);
      const yes = App.els.modalBody.querySelector("[data-action='confirm.yes']");
      yes?.addEventListener(
        "click",
        () => {
          App.hideModal();
          try {
            onConfirm();
          } catch (err) {
            console.warn(err);
            App.toast("Failed", err?.message || "Action failed.", "danger");
          }
        },
        { once: true },
      );
    },

    openAddSubjectModal() {
      const colorOptions = Utils.COLORS.map((c) => `<option value="${Utils.escapeHtml(c)}">${Utils.escapeHtml(c)}</option>`).join(
        "",
      );
      App.showModal(
        "Add subject",
        `<form class="stack" data-action="subject.add">
          <label class="stack"><span class="hint">Subject name</span><input name="name" required maxlength="60" autocomplete="off" placeholder="e.g., Biology" /></label>
          <label class="stack"><span class="hint">Color</span><select name="color">${colorOptions}</select></label>
          <div class="formRow">
            <button class="btn btn--primary" type="submit">Add Subject</button>
            <button class="btn btn--ghost" type="button" data-action="modal.close">Cancel</button>
          </div>
        </form>`,
      );
    },

    openAddExamModal() {
      const subjects = Store.state.subjects
        .map((s) => `<option value="${Utils.escapeHtml(s.id)}">${Utils.escapeHtml(s.name)}</option>`)
        .join("");
      const today = Utils.toDateKey(new Date());
      App.showModal(
        "Add exam",
        `<form class="stack" data-action="exam.add">
          <label class="stack"><span class="hint">Exam title</span><input name="title" required maxlength="120" autocomplete="off" placeholder="e.g., Midterm" /></label>
          <label class="stack"><span class="hint">Date</span><input name="dateKey" type="date" required value="${Utils.escapeHtml(
            today,
          )}" /></label>
          <label class="stack"><span class="hint">Subject (optional)</span>
            <select name="subjectId"><option value="">Not linked</option>${subjects}</select>
          </label>
          <div class="formRow">
            <button class="btn btn--primary" type="submit">Add Exam</button>
            <button class="btn btn--ghost" type="button" data-action="modal.close">Cancel</button>
          </div>
        </form>`,
      );
    },

    toast(title, message, kind) {
      const toast = document.createElement("div");
      toast.className = `toast${kind === "danger" ? " toast--danger" : ""}`;
      toast.innerHTML = `<div class="toast__title">${Utils.escapeHtml(title)}</div><div class="toast__msg">${Utils.escapeHtml(
        message,
      )}</div>`;
      App.els.toastHost.appendChild(toast);
      setTimeout(() => toast.remove(), kind === "danger" ? 4800 : 3200);
    },

    confetti() {
      const host = document.createElement("div");
      host.className = "confetti";
      const colors = ["#6ee7ff", "#a78bfa", "#34d399", "#fbbf24", "#ff4d6d"];
      const pieces = 22;
      for (let i = 0; i < pieces; i++) {
        const piece = document.createElement("div");
        piece.className = "confetti__piece";
        piece.style.left = `${Math.random() * 100}%`;
        piece.style.top = `${Math.random() * 20}%`;
        piece.style.background = colors[i % colors.length];
        piece.style.animationDelay = `${Math.random() * 140}ms`;
        piece.style.transform = `translateY(-10px) rotate(${Math.random() * 120}deg)`;
        host.appendChild(piece);
      }
      document.body.appendChild(host);
      setTimeout(() => host.remove(), 1200);
    },

    debugInfo(task) {
      if (!Store.state?.ui?.devMode || !task || !task.debug) return "";
      const d = task.debug;
      let text = "";
      if (task.type === "review") {
        text = `score ${task.score} • preset ${d.preset} • reviewAge ${d.reviewAge}d • weight ${d.subjectWeight} • boost ${d.adaptiveBoost}`;
      } else {
        text = `score ${task.score} • preset ${d.preset} • diff ${Math.round(d.difficultyScore)} • urg ${Math.round(
          d.urgencyScore,
        )} • weight ${d.subjectWeight} • age ${Math.round(d.ageBoost)} • boost ${d.adaptiveBoost} • skip -${d.skipPenalty}`;
      }
      return `<div class="debug">${Utils.escapeHtml(text)}</div>`;
    },

    updateConnectivity() {
      const online = navigator.onLine;
      const sw = navigator.serviceWorker;
      let msg = online ? "Online" : "Offline";
      if (sw && sw.controller) msg = online ? "Offline-ready (cached)" : "Offline (cached)";
      App.els.offlineStatus.textContent = msg;
    },

    applyBarWidths() {
      for (const fill of App.els.view.querySelectorAll(".bar__fill[data-pct]")) {
        const pct = Utils.clamp(Number(fill.getAttribute("data-pct")) || 0, 0, 100);
        fill.style.width = `${pct}%`;
      }
    },

    updateNav(route) {
      for (const btn of App.els.nav.querySelectorAll(".nav__item")) {
        const r = btn.getAttribute("data-route");
        btn.classList.toggle("is-active", r === route);
      }
    },

    updateStorageStatus() {
      const bytes = Engine.estimateStorageBytes(Store.state);
      const subjects = Store.state.subjects.length;
      const chapters = Store.state.subjects.reduce((acc, s) => acc + (s.chapters?.length || 0), 0);
      const exams = Store.state.exams.length;
      const sizeStr = bytes === null ? "" : `${Math.round(bytes / 1024)} KB`;
      App.els.storageStatus.textContent = `Subjects: ${subjects} • Chapters: ${chapters} • Exams: ${exams}${sizeStr ? ` • Storage: ${sizeStr}` : ""}`;
    },

    applyTheme() {
      const theme = Store.state.ui.theme || "default";
      document.body.classList.remove("theme-amoled", "theme-calm", "theme-exam", "theme-soft");
      if (theme !== "default") document.body.classList.add(`theme-${theme}`);
    },

    handleMilestones() {
      const milestone = Store.state.ui.lastMilestone;
      if (!milestone || Store.state.ui.lastMilestoneToast === milestone) return;
      App.toast("Nice work!", `Streak milestone: ${milestone} days.`, "ok");
      Store.update((s) => {
        s.ui.lastMilestoneToast = milestone;
      });
    },

    render() {
      const route = App.route();
      App.updateNav(route);
      App.els.viewSubtitle.textContent = Utils.formatDateKey(Utils.toDateKey(new Date()));

      if (route === "dashboard") {
        App.els.viewTitle.textContent = "Dashboard";
        App.els.topbarActions.innerHTML = `<select id="presetSelect" class="select" aria-label="Study preset">
            <option value="balanced" ${Store.state.ui.preset === "balanced" ? "selected" : ""}>Balanced</option>
            <option value="light" ${Store.state.ui.preset === "light" ? "selected" : ""}>Low-energy</option>
            <option value="exam" ${Store.state.ui.preset === "exam" ? "selected" : ""}>Exam crunch</option>
            <option value="revision" ${Store.state.ui.preset === "revision" ? "selected" : ""}>Revision only</option>
          </select>
          <button class="btn btn--primary btn--sm" type="button" data-action="dashboard.recommend.focus">Start Focus</button>
          <button class="btn btn--sm" type="button" data-action="subject.add.open">Add Subject</button>
          <button class="btn btn--sm" type="button" data-action="panic.open">Panic</button>`;
        App.els.view.innerHTML = App.renderDashboard();
      } else if (route === "subjects") {
        App.els.viewTitle.textContent = "Subjects";
        App.els.topbarActions.innerHTML = `<button class="btn btn--primary btn--sm" type="button" data-action="subject.add.open">Add Subject</button>`;
        App.els.view.innerHTML = App.renderSubjects();
      } else if (route === "exams") {
        App.els.viewTitle.textContent = "Exams";
        App.els.topbarActions.innerHTML = `<button class="btn btn--primary btn--sm" type="button" data-action="exam.add.open">Add Exam</button>`;
        App.els.view.innerHTML = App.renderExams();
      } else if (route === "focus") {
        App.els.viewTitle.textContent = "Focus";
        App.els.topbarActions.innerHTML = `<button class="btn btn--primary btn--sm" type="button" data-action="focus.open">Open Focus Mode</button>`;
        App.els.view.innerHTML = App.renderFocus();
      } else if (route === "analytics") {
        App.els.viewTitle.textContent = "Analytics";
        App.els.topbarActions.innerHTML = `<button class="btn btn--sm" type="button" data-action="data.export">Export</button>`;
        App.els.view.innerHTML = App.renderAnalytics();
      } else if (route === "data") {
        App.els.viewTitle.textContent = "Data";
        App.els.topbarActions.innerHTML = `<button class="btn btn--sm" type="button" data-action="data.export">Export</button>
          <button class="btn btn--sm" type="button" data-action="data.import.pick">Import</button>`;
        App.els.view.innerHTML = App.renderData();
      }

      App.applyBarWidths();
      App.applyTheme();
      FocusMode.syncAmbientUI();
      App.updateStorageStatus();
      App.updateConnectivity();
      App.handleMilestones();
      App.els.view.focus({ preventScroll: true });
    },

    pillForExam(daysLeft) {
      const label = Utils.formatDaysLeft(daysLeft);
      let cls = "pill";
      if (daysLeft === null || daysLeft === undefined) cls += "";
      else if (daysLeft <= 3) cls += " pill--danger";
      else if (daysLeft <= 14) cls += " pill--warn";
      else cls += " pill--ok";
      return `<span class="${cls}">${Utils.escapeHtml(label)}</span>`;
    },

    renderDashboard() {
      const state = Store.state;
      const planTarget = Engine.getPlanSize(state, 3);
      const candidates = Engine.computeTaskCandidates(state);
      const rec = candidates[0] || null;
      const plan = candidates.slice(0, planTarget);
      const candidateMap = new Map(candidates.map((t) => [`${t.subjectId}:${t.chapterId}`, t]));
      const progress = Engine.getProgress(state);
      const streak = state.streak;
      const focusSummary = Engine.getFocusSummary(state);
      const focusStats = Engine.getFocusStats(state);
      const focusMinutes = Store.state.focus.settings.minutes || 25;
      const exams = Engine.getUpcomingExams(state, 4);
      const todayKey = Utils.toDateKey(new Date());
      const motivation = Engine.getMotivationLine(todayKey);
      const lastCompleted = Engine.getLastCompletedTask(state);
      const soonExam = Engine.getUpcomingExams(state, 1)[0] || null;
      const showExamBanner = soonExam && soonExam.daysLeft !== null && soonExam.daysLeft <= 7;
      const missedNotice = state.ui.missedNoticeDate === todayKey;
      const weeklyPlan = Engine.getWeeklyPlan(state);
      const xp = state.gamification.xp || 0;
      const level = state.gamification.level || 1;
      const xpProgress = xp % 100;

      const recReasons = rec ? Engine.explainTask(rec, state) : [];
      const recWhy = recReasons.length
        ? `<div class="hint">Why this task?</div><div class="inline">${recReasons
            .map((r) => `<span class="pill">${Utils.escapeHtml(r)}</span>`)
            .join("")}</div>`
        : "";
      const recHtml = rec
        ? (() => {
            const diff = Engine.difficultyLabel(rec.difficulty);
            const reviewAge = rec.debug?.reviewAge;
            const meta =
              rec.type === "review"
                ? `${rec.subjectName} • Review due${reviewAge ? ` • ${reviewAge}d since last` : ""}`
                : `${rec.subjectName} • ${diff.label}${
                    rec.exam ? ` • ${Utils.formatDaysLeft(rec.exam.daysLeft)} (${rec.exam.title})` : ""
                  }`;
            const actions =
              rec.type === "review"
                ? `<button class="btn btn--primary btn--sm" type="button" data-action="chapter.focus" data-subject-id="${Utils.escapeHtml(
                    rec.subjectId,
                  )}" data-chapter-id="${Utils.escapeHtml(rec.chapterId)}">Focus</button>
                   <button class="btn btn--sm" type="button" data-action="review.complete" data-subject-id="${Utils.escapeHtml(
                     rec.subjectId,
                   )}" data-chapter-id="${Utils.escapeHtml(rec.chapterId)}">Mark reviewed</button>`
                : `<button class="btn btn--primary btn--sm" type="button" data-action="dashboard.recommend.focus">Focus</button>
                   <button class="btn btn--sm" type="button" data-action="dashboard.recommend.done">Done</button>`;
            return `<div class="row row--top">
              <div class="row__grow">
                <div class="row__title">${Utils.escapeHtml(rec.title)}</div>
                <div class="row__sub">${Utils.escapeHtml(meta)}</div>
                ${App.debugInfo(rec)}
                ${recWhy}
              </div>
              <div class="split">${actions}</div>
            </div>`;
          })()
        : `<div class="hint">No remaining chapters. Add more, or take a well-earned break.</div>`;

      const planHtml = plan.length
        ? `<div class="list">${plan
            .map((t) => {
              if (t.type === "review") {
                const reviewAge = t.debug?.reviewAge;
                const reviewMeta = reviewAge ? `${reviewAge}d since last` : "Review due";
                return `<div class="row row--top">
                  <div class="row__grow">
                    <div class="row__title">${Utils.escapeHtml(t.title)}</div>
                    <div class="row__sub">${Utils.escapeHtml(t.subjectName)} • ${Utils.escapeHtml(reviewMeta)}</div>
                    ${App.debugInfo(t)}
                  </div>
                  <div class="split">
                    <span class="pill">Review</span>
                    <button class="btn btn--sm" type="button" data-action="review.complete" data-subject-id="${Utils.escapeHtml(
                      t.subjectId,
                    )}" data-chapter-id="${Utils.escapeHtml(t.chapterId)}">Mark reviewed</button>
                    <button class="btn btn--primary btn--sm" type="button" data-action="chapter.focus" data-subject-id="${Utils.escapeHtml(
                      t.subjectId,
                    )}" data-chapter-id="${Utils.escapeHtml(t.chapterId)}">Focus</button>
                  </div>
                </div>`;
              }
              const diff = Engine.difficultyLabel(t.difficulty);
              const examPill = t.exam ? App.pillForExam(t.exam.daysLeft) : "";
              return `<div class="row">
                <label class="check row__grow">
                  <input type="checkbox" data-action="chapter.toggle" data-subject-id="${Utils.escapeHtml(
                    t.subjectId,
                  )}" data-chapter-id="${Utils.escapeHtml(t.chapterId)}" />
                  <div>
                    <div class="row__title">${Utils.escapeHtml(t.title)}</div>
                    <div class="row__sub">${Utils.escapeHtml(t.subjectName)} • ${diff.label}</div>
                    ${App.debugInfo(t)}
                  </div>
                </label>
                <div class="split">${examPill}<button class="btn btn--primary btn--sm" type="button" data-action="chapter.focus" data-subject-id="${Utils.escapeHtml(
                  t.subjectId,
                )}" data-chapter-id="${Utils.escapeHtml(t.chapterId)}">Focus</button></div>
              </div>`;
            })
            .join("")}</div>`
        : `<div class="hint">Your Today’s Plan appears once you have incomplete chapters.</div>`;

      const subjectsHtml = progress.bySubject.length
        ? `<div class="stack">${progress.bySubject
            .slice(0, 6)
            .map((s) => {
              const pct = s.total ? s.pct : 0;
              return `<div class="stack"><div class="row"><div class="row__grow"><div class="row__title">${Utils.escapeHtml(
                s.name,
              )}</div><div class="row__sub">${s.done}/${s.total} completed</div></div><span class="pill pill--primary">${pct}%</span></div><div class="bar"><div class="bar__fill" data-pct="${pct}"></div></div></div>`;
            })
            .join("")}</div>`
        : `<div class="hint">Add your first subject to get started.</div>`;

      const examsHtml = exams.length
        ? `<div class="list">${exams
            .map((ex) => {
              const subj = ex.subjectId ? Engine.getSubject(state, ex.subjectId)?.name : null;
              const pill = App.pillForExam(ex.daysLeft);
              return `<div class="row"><div class="row__grow"><div class="row__title">${Utils.escapeHtml(
                ex.title,
              )}</div><div class="row__sub">${Utils.escapeHtml(Utils.formatDateKey(ex.dateKey))}${
                subj ? ` • ${Utils.escapeHtml(subj)}` : ""
              }</div></div>${pill}</div>`;
            })
            .join("")}</div>`
        : `<div class="hint">Add an exam to unlock urgency coloring and better recommendations.</div>`;

      const banners = [];
      if (missedNotice) {
        banners.push(
          `<div class="banner banner--danger"><div class="banner__title">Yesterday was missed. Plan adjusted.</div><div class="banner__text">Start with your top task and rebuild momentum.</div></div>`,
        );
      }
      if (state.ui.preset === "light") {
        banners.push(
          `<div class="banner"><div class="banner__title">Low-energy mode</div><div class="banner__text">Shorter, gentler tasks to keep momentum.</div></div>`,
        );
      }
      if (showExamBanner) {
        const daysLeft = soonExam.daysLeft;
        const label = Utils.formatDaysLeft(daysLeft);
        banners.push(
          `<div class="banner"><div class="banner__title">${Utils.escapeHtml(soonExam.title)} • ${Utils.escapeHtml(
            label,
          )}</div><div class="banner__text">Exam countdown active — prioritize high‑impact chapters.</div></div>`,
        );
      }
      const bannerHtml = banners.length ? `<div class="stack">${banners.join("")}</div>` : "";

      const motivationHtml = `<div class="card card--flat"><div class="row"><div class="row__grow"><div class="row__title">Today’s note</div><div class="row__sub">${Utils.escapeHtml(
        motivation,
      )}</div></div></div></div>`;

      const lastCompletedHtml = lastCompleted
        ? `<div class="row"><div class="row__grow"><div class="row__title">${Utils.escapeHtml(
            lastCompleted.label || "Task completed",
          )}</div><div class="row__sub">${Utils.escapeHtml(Utils.formatDateKey(lastCompleted.dateKey || todayKey))}</div></div><span class="pill pill--ok">Latest</span></div>`
        : `<div class="hint">No completed tasks yet.</div>`;

      const weeklyHtml = `<div class="list">${weeklyPlan
        .map((day) => {
          const count = day.tasks.length;
          return `<div class="row"><div class="row__grow"><div class="row__title">${Utils.escapeHtml(
            Utils.formatDateKey(day.dateKey),
          )}</div><div class="row__sub">${count} task${count === 1 ? "" : "s"} planned</div></div><span class="pill">${
            count === 0 ? "Light" : count <= 2 ? "Balanced" : "Full"
          }</span></div>`;
        })
        .join("")}</div>`;

      const todayDaily = Engine.getDaily(state, todayKey);
      const wrapUpHtml = `<div class="stack">
        <div class="split">
          <div class="kpi"><div class="kpi__value">${Math.round(todayDaily.focusSeconds / 60)}</div><div class="kpi__label">Focus minutes</div></div>
          <div class="kpi"><div class="kpi__value">${todayDaily.focusSessions}</div><div class="kpi__label">Sessions</div></div>
          <div class="kpi"><div class="kpi__value">${todayDaily.completedChapters}</div><div class="kpi__label">Chapters</div></div>
        </div>
        <form class="stack" data-action="reflection.save">
          <textarea name="reflection" placeholder="End-of-day wrap-up: What went well?">${Utils.escapeHtml(
            (state.analytics.reflections || {})[todayKey] || "",
          )}</textarea>
          <button class="btn btn--primary" type="submit">Save wrap-up</button>
        </form>
      </div>`;

      const excludeKeys = new Set(plan.map((t) => `${t.subjectId}:${t.chapterId}`));
      if (rec) excludeKeys.add(`${rec.subjectId}:${rec.chapterId}`);
      const resurfacing = Engine.getResurfacingTasks(state, 5)
        .filter((t) => !excludeKeys.has(`${t.subjectId}:${t.chapterId}`))
        .slice(0, 3);
      const resurfaceHtml = resurfacing.length
        ? `<div class="list">${resurfacing
            .map((t) => {
              const reason = t.skipped >= 2 ? `Snoozed ${t.skipped}x` : `Waiting ${t.ageDays} days`;
              const debugHtml = App.debugInfo(candidateMap.get(`${t.subjectId}:${t.chapterId}`));
              return `<div class="row">
                <div class="row__grow">
                  <div class="row__title">${Utils.escapeHtml(t.title)}</div>
                  <div class="row__sub">${Utils.escapeHtml(t.subjectName)} • ${Utils.escapeHtml(reason)}</div>
                  ${debugHtml}
                </div>
                <div class="split">
                  <button class="btn btn--primary btn--sm" type="button" data-action="chapter.focus" data-subject-id="${Utils.escapeHtml(
                    t.subjectId,
                  )}" data-chapter-id="${Utils.escapeHtml(t.chapterId)}">Focus</button>
                  <button class="btn btn--sm" type="button" data-action="chapter.snooze" data-subject-id="${Utils.escapeHtml(
                    t.subjectId,
                  )}" data-chapter-id="${Utils.escapeHtml(t.chapterId)}">Snooze</button>
                </div>
              </div>`;
            })
            .join("")}</div>`
        : `<div class="hint">No low-pressure tasks need resurfacing right now.</div>`;

      return `<div class="grid">
        <div class="col-8">
          ${bannerHtml}
          ${motivationHtml}
          <div class="card"><div class="card__titleRow"><div class="card__title">Smart recommendation</div><div class="card__hint">Difficulty + exam urgency</div></div>${recHtml}</div>
          <div class="card"><div class="card__titleRow"><div class="card__title">Today’s Plan</div><div class="card__hint">Top 3 tasks</div></div>${planHtml}</div>
          <div class="card"><div class="card__titleRow"><div class="card__title">Progress overview</div><div class="card__hint">${progress.done}/${progress.total} chapters completed</div></div>
            <div class="stack"><div class="row"><div class="row__grow"><div class="row__title">Overall completion</div><div class="row__sub">Keep it steady.</div></div><span class="pill pill--primary">${progress.pct}%</span></div>
            <div class="bar"><div class="bar__fill" data-pct="${progress.pct}"></div></div><div class="divider"></div>${subjectsHtml}</div>
          </div>
          <div class="card"><div class="card__titleRow"><div class="card__title">Weekly plan</div><div class="card__hint">Auto-balanced for the next 7 days</div></div>${weeklyHtml}</div>
        </div>
        <div class="col-4">
          <div class="card"><div class="card__titleRow"><div class="card__title">Streak</div><div class="card__hint">Once per active day</div></div>
            <div class="split"><div class="kpi"><div class="kpi__value">${streak.current}</div><div class="kpi__label">Current</div></div><div class="kpi"><div class="kpi__value">${streak.longest}</div><div class="kpi__label">Longest</div></div></div>
            <div class="hint">Any focus session or chapter completion counts as activity.</div>
          </div>
          <div class="card"><div class="card__titleRow"><div class="card__title">Level</div><div class="card__hint">XP progress</div></div>
            <div class="split"><div class="kpi"><div class="kpi__value">${level}</div><div class="kpi__label">Level</div></div><div class="kpi"><div class="kpi__value">${xp}</div><div class="kpi__label">XP</div></div></div>
            <div class="divider"></div><div class="bar"><div class="bar__fill" data-pct="${xpProgress}"></div></div>
          </div>
          <div class="card"><div class="card__titleRow"><div class="card__title">Focus</div><div class="card__hint">Today</div></div>
            <div class="split"><div class="kpi"><div class="kpi__value">${Math.round(
              focusSummary.today.focusSeconds / 60,
            )}</div><div class="kpi__label">Minutes</div></div><div class="kpi"><div class="kpi__value">${focusSummary.today.focusSessions}</div><div class="kpi__label">Sessions</div></div></div>
            <div class="divider"></div><button class="btn btn--primary" type="button" data-action="dashboard.recommend.focus">Start ${focusMinutes}:00</button>
          </div>
          <div class="card"><div class="card__titleRow"><div class="card__title">End-of-day wrap-up</div><div class="card__hint">Reflect + close</div></div>${wrapUpHtml}</div>
          <div class="card"><div class="card__titleRow"><div class="card__title">Last completed</div><div class="card__hint">Most recent</div></div>${lastCompletedHtml}</div>
          <div class="card"><div class="card__titleRow"><div class="card__title">Low pressure tasks</div><div class="card__hint">Resurfaced gently</div></div>${resurfaceHtml}</div>
          <div class="card"><div class="card__titleRow"><div class="card__title">Upcoming exams</div><div class="card__hint">Stay ahead</div></div>${examsHtml}
            <div class="divider"></div><div class="split"><button class="btn btn--sm" type="button" data-action="exam.add.open">Add exam</button><button class="btn btn--sm" type="button" data-route="exams">View all</button></div>
          </div>
        </div>
      </div>`;
    },

    renderSubjects() {
      const state = Store.state;
      const taskScores = new Map();
      for (const t of Engine.computeTaskCandidates(state)) {
        if (t.type !== "study") continue;
        taskScores.set(`${t.subjectId}:${t.chapterId}`, t);
      }
      if (!state.subjects.length) {
        return `<div class="card"><div class="card__titleRow"><div class="card__title">Subjects & chapters</div><div class="card__hint">Build your study map</div></div>
          <div class="hint">Add a subject, then add chapters. Chapters are your tasks.</div><div class="divider"></div>
          <button class="btn btn--primary" type="button" data-action="subject.add.open">Add your first subject</button></div>`;
      }

      const progress = Engine.getProgress(state);
      const cards = state.subjects
        .map((subject) => {
          const subjProg = progress.bySubject.find((x) => x.id === subject.id) || { total: 0, done: 0, pct: 0 };
          const chapters = subject.chapters
            .slice()
            .sort((a, b) => {
              const aDone = Boolean(a.completedAt);
              const bDone = Boolean(b.completedAt);
              if (aDone && !bDone) return 1;
              if (!aDone && bDone) return -1;
              const aScore = taskScores.get(`${subject.id}:${a.id}`)?.score || 0;
              const bScore = taskScores.get(`${subject.id}:${b.id}`)?.score || 0;
              return bScore - aScore;
            })
            .map((ch) => {
              const diff = Engine.difficultyLabel(ch.difficulty);
              const checked = ch.completedAt ? "checked" : "";
              const completedAt = ch.completedAt ? new Date(ch.completedAt) : null;
              const reviewReady =
                completedAt && (Utils.startOfLocalDay(new Date()) - Utils.startOfLocalDay(completedAt)) / Utils.DAY_MS >= 7;
              const debugHtml = App.debugInfo(taskScores.get(`${subject.id}:${ch.id}`));
              return `<div class="row">
                <label class="check row__grow">
                  <input type="checkbox" ${checked} data-action="chapter.toggle" data-subject-id="${Utils.escapeHtml(
                    subject.id,
                  )}" data-chapter-id="${Utils.escapeHtml(ch.id)}" />
                  <div>
                    <div class="row__title">${Utils.escapeHtml(ch.title)}</div>
                    <div class="row__sub">${diff.label}${ch.completedAt ? " • Completed" : ""}</div>
                    ${debugHtml}
                  </div>
                </label>
                <div class="split">
                  <span class="pill pill--${diff.kind}">${diff.label}</span>
                  ${
                    ch.completedAt
                      ? reviewReady
                        ? `<button class="btn btn--sm" type="button" data-action="review.complete" data-subject-id="${Utils.escapeHtml(
                            subject.id,
                          )}" data-chapter-id="${Utils.escapeHtml(ch.id)}">Review</button>`
                        : ""
                      : `<button class="btn btn--primary btn--sm" type="button" data-action="chapter.focus" data-subject-id="${Utils.escapeHtml(
                          subject.id,
                        )}" data-chapter-id="${Utils.escapeHtml(ch.id)}">Focus</button>`
                  }
                  ${
                    ch.completedAt
                      ? ""
                      : `<button class="btn btn--sm" type="button" data-action="chapter.snooze" data-subject-id="${Utils.escapeHtml(
                          subject.id,
                        )}" data-chapter-id="${Utils.escapeHtml(ch.id)}">Snooze</button>`
                  }
                  <button class="btn btn--sm" type="button" data-action="chapter.delete" data-subject-id="${Utils.escapeHtml(
                    subject.id,
                  )}" data-chapter-id="${Utils.escapeHtml(ch.id)}">Delete</button>
                </div>
              </div>`;
            })
            .join("");

          return `<div class="card">
            <div class="card__titleRow">
              <div><div class="card__title">${Utils.escapeHtml(subject.name)}</div><div class="card__hint">${subjProg.done}/${
                subjProg.total
              } completed</div></div>
              <div class="split">
                <select class="select" data-field="weight" data-subject-id="${Utils.escapeHtml(subject.id)}" aria-label="Subject weight">
                  <option value="1" ${subject.weight === 1 ? "selected" : ""}>Weight: Low</option>
                  <option value="2" ${subject.weight === 2 ? "selected" : ""}>Weight: Med</option>
                  <option value="3" ${subject.weight === 3 ? "selected" : ""}>Weight: High</option>
                </select>
                <button class="btn btn--sm" type="button" data-action="subject.toggle" data-subject-id="${Utils.escapeHtml(
                  subject.id,
                )}">${subject.collapsed ? "Expand" : "Collapse"}</button>
                <button class="btn btn--sm" type="button" data-action="subject.delete" data-subject-id="${Utils.escapeHtml(
                  subject.id,
                )}">Delete</button>
              </div>
            </div>
            <div class="bar"><div class="bar__fill" data-pct="${subjProg.pct}"></div></div>
            <div class="divider"></div>
            ${
              subject.collapsed
                ? `<div class="hint">Section collapsed.</div>`
                : `<div class="stack">${chapters || `<div class="hint">No chapters yet.</div>`}</div>
                  <div class="divider"></div>
                  <form class="stack" data-action="chapter.add" data-subject-id="${Utils.escapeHtml(subject.id)}">
                    <div class="formRow">
                      <input name="title" required maxlength="120" placeholder="Add a chapter…" autocomplete="off" />
                      <select name="difficulty" aria-label="Difficulty"><option value="1">Easy</option><option value="2" selected>Medium</option><option value="3">Hard</option></select>
                    </div>
                    <button class="btn btn--primary" type="submit">Add chapter</button>
                  </form>`
            }
          </div>`;
        })
        .join("");
      return `<div class="stack">${cards}</div>`;
    },

    renderExams() {
      const state = Store.state;
      if (!state.exams.length) {
        return `<div class="card"><div class="card__titleRow"><div class="card__title">Exams</div><div class="card__hint">Deadlines drive urgency</div></div>
          <div class="hint">Add your upcoming exams to get better recommendations and Panic Mode targeting.</div><div class="divider"></div>
          <button class="btn btn--primary" type="button" data-action="exam.add.open">Add your first exam</button></div>`;
      }

      const rows = state.exams
        .slice()
        .map((e) => ({ ...e, daysLeft: Utils.daysLeft(e.dateKey) }))
        .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0))
        .map((ex) => {
          const subject = ex.subjectId ? Engine.getSubject(state, ex.subjectId) : null;
          const pill = App.pillForExam(ex.daysLeft);
          return `<div class="card card--flat"><div class="row row--top">
            <div class="row__grow"><div class="row__title">${Utils.escapeHtml(ex.title)}</div><div class="row__sub">${Utils.escapeHtml(
              Utils.formatDateKey(ex.dateKey),
            )}${subject ? ` • ${Utils.escapeHtml(subject.name)}` : ""}</div></div>
            <div class="split">${pill}<button class="btn btn--sm" type="button" data-action="exam.delete" data-exam-id="${Utils.escapeHtml(
              ex.id,
            )}">Delete</button></div></div></div>`;
        })
        .join("");

      return `<div class="card"><div class="card__titleRow"><div class="card__title">Your exams</div><div class="card__hint">Sorted by urgency</div></div><div class="stack">${rows}</div></div>`;
    },

    renderFocus() {
      const state = Store.state;
      const tasks = Engine.computeTaskCandidates(state);
      const focusSummary = Engine.getFocusSummary(state);
      const minutes = Store.state.focus.settings.minutes || 25;
      const recent = state.focus.history.slice().reverse().slice(0, 10);

      const taskOptions = tasks.length
        ? tasks
            .slice(0, 60)
            .map((t) => {
              const label =
                t.type === "review" ? `Review • ${t.subjectName} • ${t.title}` : `${t.subjectName} • ${t.title}`;
              return `<option value="${Utils.escapeHtml(`${t.subjectId}:${t.chapterId}`)}">${Utils.escapeHtml(
                label,
              )}</option>`;
            })
            .join("")
        : "";

      const recentHtml = recent.length
        ? `<div class="list">${recent
            .map((s) => {
              const label = s.task?.label ? String(s.task.label) : "Focus session";
              const dayKey = s.startedAt ? Utils.toDateKey(new Date(s.startedAt)) : null;
              const day = dayKey ? Utils.formatDateKey(dayKey) : "";
              return `<div class="row"><div class="row__grow"><div class="row__title">${Utils.escapeHtml(
                label,
              )}</div><div class="row__sub">${Utils.escapeHtml(day)} • ${Utils.escapeHtml(Utils.formatDuration(s.durationSec))}</div></div><span class="pill pill--primary">Done</span></div>`;
            })
            .join("")}</div>`
        : `<div class="hint">No completed focus sessions yet.</div>`;

      const ambient = state.focus.settings;

      return `<div class="grid">
        <div class="col-8">
          <div class="card"><div class="card__titleRow"><div class="card__title">Start a session</div><div class="card__hint">${minutes} minutes • completion logs the session</div></div>
            ${
              tasks.length
                ? `<div class="stack"><label class="stack"><span class="hint">Task</span><select id="focusTaskSelect">${taskOptions}</select></label>
                   <div class="split"><button class="btn btn--primary" type="button" data-action="focus.open">Open Focus Mode</button>
                   <button class="btn" type="button" data-action="dashboard.recommend.focus">Use recommendation</button></div>
                   <div class="hint">Tip: Press Ctrl/Cmd + P to open Panic Mode instantly.</div></div>`
                : `<div class="hint">Add a subject and an incomplete chapter to start Focus Mode.</div><div class="divider"></div><button class="btn btn--primary" type="button" data-action="subject.add.open">Add subject</button>`
            }
          </div>
          <div class="card"><div class="card__titleRow"><div class="card__title">Micro-focus sessions</div><div class="card__hint">Quick resets</div></div>
            <div class="inline">
              <button class="chip" type="button" data-action="focus.micro" data-minutes="5">5 min</button>
              <button class="chip" type="button" data-action="focus.micro" data-minutes="10">10 min</button>
              <button class="chip" type="button" data-action="focus.micro" data-minutes="15">15 min</button>
            </div>
            <div class="hint">Perfect for low-energy bursts or quick reviews.</div>
          </div>
          <div class="card"><div class="card__titleRow"><div class="card__title">Recent sessions</div><div class="card__hint">Last 10</div></div>${recentHtml}</div>
        </div>
        <div class="col-4">
          <div class="card"><div class="card__titleRow"><div class="card__title">Focus summary</div><div class="card__hint">Today + last 7 days</div></div>
            <div class="split"><div class="kpi"><div class="kpi__value">${Math.round(
              focusSummary.today.focusSeconds / 60,
            )}</div><div class="kpi__label">Minutes today</div></div><div class="kpi"><div class="kpi__value">${Math.round(
        focusSummary.last7.focusSeconds / 60,
      )}</div><div class="kpi__label">Minutes (7d)</div></div></div>
            <div class="divider"></div>
            <div class="split"><div class="kpi"><div class="kpi__value">${focusSummary.today.focusSessions}</div><div class="kpi__label">Sessions today</div></div>
              <div class="kpi"><div class="kpi__value">${focusSummary.last7.focusSessions}</div><div class="kpi__label">Sessions (7d)</div></div></div>
          </div>
          <div class="card"><div class="card__titleRow"><div class="card__title">Ambient noise</div><div class="card__hint">Optional</div></div>
            <div class="stack"><div class="row"><div class="row__grow"><div class="row__title">Status</div><div class="row__sub">${ambient.ambientEnabled ? "Enabled" : "Disabled"} • ${Utils.escapeHtml(
        ambient.ambientPreset,
      )} • ${Math.round((ambient.volume ?? 0.35) * 100)}%</div></div><button class="btn btn--sm" type="button" data-action="focus.open">Open</button></div>
            <div class="hint">You can toggle ambient noise inside Focus Mode.</div></div>
          </div>
        </div>
      </div>`;
    },

    renderAnalytics() {
      const state = Store.state;
      const heatmapDays = state.ui.heatmapDays || 60;
      const heat = Engine.getHeatmap(state, heatmapDays);
      const focusSummary = Engine.getFocusSummary(state);
      const focusStats = Engine.getFocusStats(state);
      const streak = state.streak;
      const logs = Engine.getActivityLogs(state, 24);
      const todayKey = Utils.toDateKey(new Date());
      const reflections = state.analytics.reflections || {};
      const reflectionToday = reflections[todayKey] || "";

      const heatCells = heat
        .map((c) => {
          const cls = c.level ? `heatCell h${c.level}` : "heatCell";
          const title = `${Utils.formatDateKey(c.dateKey)} • ${c.minutes}m focus • ${c.sessions} sessions • ${c.chapters} chapters`;
          return `<div class="${cls}" title="${Utils.escapeHtml(title)}"></div>`;
        })
        .join("");

      const heatCols = heatmapDays === 90 ? 15 : 10;

      const logsHtml = logs.length
        ? `<div class="list">${logs
            .map((log) => {
              const time = log.timestamp ? new Date(log.timestamp) : new Date();
              const label = log.label || log.type;
              const when = Utils.formatDateKey(Utils.toDateKey(time));
              return `<div class="row"><div class="row__grow"><div class="row__title">${Utils.escapeHtml(
                label,
              )}</div><div class="row__sub">${Utils.escapeHtml(when)} • ${Utils.escapeHtml(log.type)}</div></div><span class="pill">${
                log.type.includes("focus")
                  ? "Focus"
                  : log.type.includes("review")
                    ? "Review"
                    : log.type.includes("reflection")
                      ? "Reflection"
                      : "Task"
              }</span></div>`;
            })
            .join("")}</div>`
        : `<div class="hint">No activity yet.</div>`;

      const reflectionEntries = Object.entries(reflections)
        .sort((a, b) => (a[0] < b[0] ? 1 : -1))
        .slice(0, 7);
      const reflectionList = reflectionEntries.length
        ? `<div class="list">${reflectionEntries
            .map(([dateKey, text]) => {
              return `<div class="row row--top"><div class="row__grow"><div class="row__title">${Utils.escapeHtml(
                Utils.formatDateKey(dateKey),
              )}</div><div class="row__sub">${Utils.escapeHtml(text)}</div></div></div>`;
            })
            .join("")}</div>`
        : `<div class="hint">No reflections yet.</div>`;

      const last14 = [];
      for (let i = 0; i < 14; i++) {
        const key = Utils.toDateKey(new Date(Utils.startOfLocalDay(new Date()).getTime() - i * Utils.DAY_MS));
        last14.push({ key, ...Engine.getDaily(state, key) });
      }
      const dailyHtml = last14
        .map((d) => {
          const active = d.focusSeconds > 0 || d.completedChapters > 0 || d.focusSessions > 0;
          const pill = active ? `<span class="pill pill--ok">Active</span>` : `<span class="pill">Quiet</span>`;
          return `<div class="row"><div class="row__grow"><div class="row__title">${Utils.escapeHtml(
            Utils.formatDateKey(d.key),
          )}</div><div class="row__sub">${Math.round(d.focusSeconds / 60)}m focus • ${d.focusSessions} sessions • ${
            d.completedChapters
          } chapters</div></div>${pill}</div>`;
        })
        .join("");

      return `<div class="grid">
        <div class="col-8">
          <div class="card"><div class="card__titleRow"><div class="card__title">Consistency heatmap</div><div class="card__hint">Last ${heatmapDays} days</div></div>
            <div class="inline">
              <button class="chip ${heatmapDays === 30 ? "is-active" : ""}" type="button" data-action="heatmap.set" data-days="30">30d</button>
              <button class="chip ${heatmapDays === 60 ? "is-active" : ""}" type="button" data-action="heatmap.set" data-days="60">60d</button>
              <button class="chip ${heatmapDays === 90 ? "is-active" : ""}" type="button" data-action="heatmap.set" data-days="90">90d</button>
            </div>
            <div class="heatmap" style="--heat-cols:${heatCols}">${heatCells}</div><div class="divider"></div><div class="hint">Every focus session and chapter completion contributes to activity.</div>
          </div>
          <div class="card"><div class="card__titleRow"><div class="card__title">Activity log</div><div class="card__hint">Latest actions</div></div>${logsHtml}</div>
          <div class="card"><div class="card__titleRow"><div class="card__title">Daily summary</div><div class="card__hint">Last 14 days</div></div><div class="list">${dailyHtml}</div></div>
          <div class="card"><div class="card__titleRow"><div class="card__title">End-of-day reflection</div><div class="card__hint">One line per day</div></div>
            <form class="stack" data-action="reflection.save">
              <textarea name="reflection" placeholder="What did you complete today?">${Utils.escapeHtml(reflectionToday)}</textarea>
              <button class="btn btn--primary" type="submit">Save reflection</button>
            </form>
            <div class="divider"></div>
            ${reflectionList}
          </div>
        </div>
        <div class="col-4">
          <div class="card"><div class="card__titleRow"><div class="card__title">Streaks</div><div class="card__hint">One increment per day</div></div>
            <div class="split"><div class="kpi"><div class="kpi__value">${streak.current}</div><div class="kpi__label">Current</div></div><div class="kpi"><div class="kpi__value">${streak.longest}</div><div class="kpi__label">Longest</div></div></div>
            <div class="hint">Missing a day resets the current streak.</div>
          </div>
          <div class="card"><div class="card__titleRow"><div class="card__title">Focus time</div><div class="card__hint">Summary</div></div>
            <div class="stack">
              <div class="row"><div class="row__grow"><div class="row__title">Today</div><div class="row__sub">${focusSummary.today.focusSessions} sessions</div></div><span class="pill pill--primary">${Math.round(
        focusSummary.today.focusSeconds / 60,
      )}m</span></div>
              <div class="row"><div class="row__grow"><div class="row__title">Last 7 days</div><div class="row__sub">${focusSummary.last7.focusSessions} sessions</div></div><span class="pill pill--primary">${Math.round(
        focusSummary.last7.focusSeconds / 60,
      )}m</span></div>
              <div class="row"><div class="row__grow"><div class="row__title">All time</div><div class="row__sub">Total focus minutes</div></div><span class="pill pill--primary">${Math.round(
        focusSummary.totalFocusSeconds / 60,
      )}m</span></div>
            </div>
          </div>
          <div class="card"><div class="card__titleRow"><div class="card__title">Focus analytics</div><div class="card__hint">Session insights</div></div>
            <div class="stack">
              <div class="row"><div class="row__grow"><div class="row__title">Average session</div><div class="row__sub">Minutes per focus</div></div><span class="pill pill--primary">${Math.round(
        focusStats.averageSessionSec / 60,
      )}m</span></div>
              <div class="row"><div class="row__grow"><div class="row__title">Most focused subject</div><div class="row__sub">${Utils.escapeHtml(
        focusStats.mostFocusedSubject,
      )}</div></div><span class="pill">${focusStats.mostFocusedMinutes}m</span></div>
            </div>
          </div>
        </div>
      </div>`;
    },

    renderData() {
      const theme = Store.state.ui.theme || "default";
      const assets = Store.state.focus.assets || {};
      const themeChip = (value, label) =>
        `<button class="chip ${theme === value ? "is-active" : ""}" type="button" data-action="theme.set" data-theme="${Utils.escapeHtml(
          value,
        )}">${Utils.escapeHtml(label)}</button>`;
      const ambientRow = (preset, label) => {
        const has = Boolean(assets[preset]);
        return `<div class="row"><div class="row__grow"><div class="row__title">${Utils.escapeHtml(
          label,
        )}</div><div class="row__sub">${has ? "Custom MP3 loaded" : "Using built-in noise"}</div></div>
          <div class="split">
            <button class="btn btn--sm" type="button" data-action="ambient.upload" data-preset="${Utils.escapeHtml(
              preset,
            )}">Upload</button>
            <button class="btn btn--sm" type="button" data-action="ambient.clear" data-preset="${Utils.escapeHtml(
              preset,
            )}" ${has ? "" : "disabled"}>Reset</button>
          </div></div>`;
      };
      return `<div class="grid">
        <div class="col-6"><div class="card"><div class="card__titleRow"><div class="card__title">Backup & export</div><div class="card__hint">Safe storage</div></div>
          <div class="stack">
            <div class="hint">Download your full Steady database or a summary snapshot.</div>
            <div class="split">
              <button class="btn btn--primary" type="button" data-action="data.export">Export data</button>
              <button class="btn" type="button" data-action="stats.export">Export stats</button>
            </div>
            <div class="divider"></div>
            <div class="hint">Import a Steady export JSON file. This overwrites local data on this device.</div>
            <button class="btn" type="button" data-action="data.import.pick">Choose file…</button>
          </div>
        </div></div>
        <div class="col-6"><div class="card"><div class="card__titleRow"><div class="card__title">Preferences</div><div class="card__hint">Theme + debug</div></div>
          <div class="stack">
            <div class="hint">Theme</div>
            <div class="inline">
              ${themeChip("default", "Default")}
              ${themeChip("amoled", "AMOLED")}
              ${themeChip("calm", "Calm blue")}
              ${themeChip("exam", "Exam week")}
              ${themeChip("soft", "Soft gray")}
            </div>
            <div class="divider"></div>
            <label class="toggle">
              <input type="checkbox" id="devToggle" ${Store.state.ui.devMode ? "checked" : ""} />
              <span>Dev mode (show scoring)</span>
            </label>
          </div>
        </div></div>
        <div class="col-12"><div class="card"><div class="card__titleRow"><div class="card__title">Ambient sounds</div><div class="card__hint">Upload your MP3s</div></div>
          <div class="stack">
            ${ambientRow("rain", "Rain")}
            ${ambientRow("waves", "Waves")}
            ${ambientRow("brown", "Brown noise")}
            ${ambientRow("fan", "Fan")}
            ${ambientRow("library", "Library")}
            ${ambientRow("white", "White noise")}
            <div class="hint">Files are stored locally in your browser to keep Steady installable offline.</div>
          </div>
        </div></div>
        <div class="col-12"><div class="card"><div class="card__titleRow"><div class="card__title dangerText">Reset options</div><div class="card__hint">Irreversible</div></div>
          <div class="stack">
            <div class="hint">Reset only what you need.</div>
            <div class="split">
              <button class="btn btn--danger" type="button" data-action="data.reset.analytics">Reset analytics</button>
              <button class="btn btn--danger" type="button" data-action="data.reset.tasks">Reset tasks</button>
              <button class="btn btn--danger" type="button" data-action="data.reset">Hard reset</button>
            </div>
          </div>
        </div></div>
      </div>`;
    },

    openPanic() {
      document.body.classList.add("panic-on");
      App.els.panicOverlay.classList.remove("hidden");
      App.renderPanic();
    },

    closePanic() {
      document.body.classList.remove("panic-on");
      App.els.panicOverlay.classList.add("hidden");
    },

    renderPanic() {
      const task = Engine.getMostUrgentTask(Store.state);
      if (!task) {
        App.els.panicMeta.textContent = "No remaining chapters.";
        App.els.panicBody.innerHTML = `<div class="card card--flat"><div class="row"><div class="row__grow"><div class="row__title">You’re clear.</div><div class="row__sub">Add a chapter or exit Panic Mode.</div></div><button class="btn btn--primary" type="button" data-action="panic.close">Exit</button></div></div>`;
        return;
      }
      const diff = Engine.difficultyLabel(task.difficulty);
      const focusMinutes = Store.state.focus.settings.minutes || 25;
      const typeLabel = task.type === "review" ? "Review due" : diff.label;
      const examLine = task.exam
        ? ` • ${Utils.escapeHtml(task.exam.title)} • ${Utils.escapeHtml(Utils.formatDaysLeft(task.exam.daysLeft))}`
        : "";
      App.els.panicMeta.textContent = `${task.subjectName}${examLine}`;
      App.els.panicBody.innerHTML = `<div class="card card--flat"><div class="stack">
        <div class="row row--top"><div class="row__grow"><div class="row__title">${Utils.escapeHtml(
          task.title,
        )}</div><div class="row__sub">${Utils.escapeHtml(task.subjectName)} • ${typeLabel}</div></div><span class="pill pill--${diff.kind}">${typeLabel}</span></div>
        <div class="divider"></div>
        <div class="split">
          <button class="btn btn--danger" type="button" data-action="panic.complete" data-subject-id="${Utils.escapeHtml(
            task.subjectId,
          )}" data-chapter-id="${Utils.escapeHtml(task.chapterId)}" data-task-type="${Utils.escapeHtml(
            task.type || "study",
          )}">${task.type === "review" ? "Log review" : "One-click complete"}</button>
          <button class="btn btn--primary" type="button" data-action="chapter.focus" data-subject-id="${Utils.escapeHtml(
            task.subjectId,
          )}" data-chapter-id="${Utils.escapeHtml(task.chapterId)}">Focus ${focusMinutes}:00</button>
        </div>
        <div class="hint">Panic Mode hides everything except the most urgent task.</div>
      </div></div>`;
    },

    setupInstallPrompt() {
      const btn = App.els.installBtn;
      if (!btn) return;
      window.addEventListener("beforeinstallprompt", (e) => {
        e.preventDefault();
        App.deferredInstallPrompt = e;
        btn.classList.remove("hidden");
        btn.setAttribute("data-action", "install.prompt");
      });
      window.addEventListener("appinstalled", () => {
        App.deferredInstallPrompt = null;
        btn.classList.add("hidden");
        App.toast("Installed", "Steady is ready on your home screen.", "ok");
      });
    },

    async promptInstall() {
      const e = App.deferredInstallPrompt;
      if (!e) return void App.toast("Install unavailable", "Your browser doesn't support installation here.", "danger");
      try {
        e.prompt();
        await e.userChoice;
      } catch (err) {
        console.warn(err);
      } finally {
        App.deferredInstallPrompt = null;
        App.els.installBtn.classList.add("hidden");
      }
    },

    async registerServiceWorker() {
      if (!("serviceWorker" in navigator)) return;
      if (!window.isSecureContext) return;

      const swCode = `
        const CACHE_NAME = 'steady-cache-v1';
        const scope = self.registration.scope;
        const CORE = [
          new URL('./', scope).href,
          new URL('./index.html', scope).href,
          new URL('./style.css', scope).href,
          new URL('./script.js', scope).href
        ];

        self.addEventListener('install', (event) => {
          event.waitUntil(
            caches.open(CACHE_NAME)
              .then((cache) => cache.addAll(CORE))
              .then(() => self.skipWaiting())
          );
        });

        self.addEventListener('activate', (event) => {
          event.waitUntil(
            caches.keys()
              .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
              .then(() => self.clients.claim())
          );
        });

        self.addEventListener('fetch', (event) => {
          const req = event.request;
          if (req.method !== 'GET') return;
          const url = new URL(req.url);
          if (url.origin !== self.location.origin) return;

          if (req.mode === 'navigate') {
            event.respondWith((async () => {
              const cache = await caches.open(CACHE_NAME);
              const cached = (await cache.match(CORE[1])) || (await cache.match(CORE[0]));
              try {
                const fresh = await fetch(req);
                if (fresh && fresh.ok) await cache.put(CORE[1], fresh.clone());
                return fresh;
              } catch (e) {
                return cached || Response.error();
              }
            })());
            return;
          }

          event.respondWith((async () => {
            const cache = await caches.open(CACHE_NAME);
            const cached = await cache.match(req);
            if (cached) return cached;
            try {
              const fresh = await fetch(req);
              if (fresh && fresh.ok) await cache.put(req, fresh.clone());
              return fresh;
            } catch (e) {
              return cached || Response.error();
            }
          })());
        });
      `;

      try {
        const url = URL.createObjectURL(new Blob([swCode], { type: "text/javascript" }));
        await navigator.serviceWorker.register(url, { scope: "./" });
        navigator.serviceWorker.ready.then(() => App.updateConnectivity()).catch(() => {});
      } catch (err) {
        console.warn("Service worker registration failed:", err);
      }
    },
  };

  document.addEventListener("DOMContentLoaded", () => App.init());
})();
