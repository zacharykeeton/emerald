import { useState } from 'react';
import { CRASHED_TEXT, crashedTitle, daemonOutdated, otherHomeText, outdatedText } from './daemon-model.ts';
import { dismissCrash, useStore } from './store.ts';

// Shown while the window is connected to a daemon older than itself, which
// happens after every upgrade because the daemon survives on purpose.
// Restart kills it through the main process; the pipe client then starts
// the shipped one and the banner goes when the new hello arrives. Not a
// .banner: the verify scripts wait for .banner to clear after a daemon
// restart, and this one has its own life.
//
// A daemon serving another home than the window's (M9 fix 495) is said
// first, and has no Restart: that would stop another home's daemon.
//
// A daemon the window started that ended on a crash code (M9 fix 815) is
// said after the home banner and before the level one, once the restarted
// daemon is up; Not now clears it in the store.
export function DaemonBanner() {
  const { daemon, crashed } = useStore('daemon', 'crashed');
  // Both keyed by pid: the banner stays mounted across a restart when the
  // new daemon is old too (a script does that), and must not stay disabled
  // or dismissed for it. The dismissal names which banner it was, so
  // putting the home banner away still shows the level one.
  const [restartingPid, setRestartingPid] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (daemon === null) return null;
  const homeKey = `home:${daemon.pid}`;
  const levelKey = `level:${daemon.pid}`;
  if (daemon.otherHome !== null && dismissed !== homeKey) {
    return (
      <div className="daemon-banner" data-daemon-pid={daemon.pid} data-reason="home">
        <span className="daemon-banner-text">{otherHomeText(daemon)}</span>
        <button className="secondary daemon-dismiss" onClick={() => setDismissed(homeKey)}>
          Not now
        </button>
      </div>
    );
  }
  if (crashed !== null && crashed.pid !== daemon.pid) {
    return (
      <div className="daemon-banner" data-daemon-pid={daemon.pid} data-crashed-pid={crashed.pid} data-reason="crash">
        <span className="daemon-banner-text" title={crashedTitle(crashed)}>
          {CRASHED_TEXT}
        </span>
        <button className="secondary daemon-dismiss" onClick={dismissCrash}>
          Not now
        </button>
      </div>
    );
  }
  if (!daemonOutdated(daemon) || dismissed === levelKey) return null;
  const restarting = restartingPid === daemon.pid;

  const restart = async () => {
    setRestartingPid(daemon.pid);
    try {
      await window.emerald.restartDaemon();
    } catch (err) {
      console.warn('[emerald] daemon restart failed', err);
      setRestartingPid(null);
    }
  };
  return (
    <div className="daemon-banner" data-daemon-pid={daemon.pid} data-reason="level">
      <span className="daemon-banner-text">{outdatedText(daemon)}</span>
      <button className="daemon-restart" onClick={() => void restart()} disabled={restarting}>
        {restarting ? 'Restarting' : 'Restart emmerd'}
      </button>
      <button className="secondary daemon-dismiss" onClick={() => setDismissed(levelKey)} disabled={restarting}>
        Not now
      </button>
    </div>
  );
}
