import { execFile } from 'child_process';
import { QueueSchedule } from './types';

export class SchedulerManager {
  private timer: NodeJS.Timeout | null = null;
  private onTriggerStart: () => void;
  private onTriggerStop: () => void;
  private schedule: QueueSchedule | null = null;
  private isWithinWindow: boolean = false;

  constructor(onStart: () => void, onStop: () => void) {
    this.onTriggerStart = onStart;
    this.onTriggerStop = onStop;
  }

  public setSchedule(schedule?: QueueSchedule): void {
    this.schedule = schedule || null;
    this.checkSchedule();

    if (this.schedule && this.schedule.enabled) {
      if (!this.timer) {
        // Check schedule every 20 seconds
        this.timer = setInterval(() => this.checkSchedule(), 20000);
      }
    } else {
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
      this.isWithinWindow = false;
    }
  }

  private checkSchedule(): void {
    if (!this.schedule || !this.schedule.enabled) return;

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const startMinutes = this.schedule.startHour * 60 + this.schedule.startMinute;
    const stopMinutes = this.schedule.stopHour * 60 + this.schedule.stopMinute;

    let inWindow = false;
    if (startMinutes < stopMinutes) {
      // Normal daytime window (e.g. 02:00 to 06:00)
      inWindow = currentMinutes >= startMinutes && currentMinutes < stopMinutes;
    } else {
      // Overnight window (e.g. 23:00 to 07:00)
      inWindow = currentMinutes >= startMinutes || currentMinutes < stopMinutes;
    }

    if (inWindow && !this.isWithinWindow) {
      this.isWithinWindow = true;
      console.log(`[Scheduler] Entered download window (${this.schedule.startHour}:${this.schedule.startMinute} - ${this.schedule.stopHour}:${this.schedule.stopMinute}). Resuming queue.`);
      this.onTriggerStart();
    } else if (!inWindow && this.isWithinWindow) {
      this.isWithinWindow = false;
      console.log(`[Scheduler] Exited download window. Pausing active downloads.`);
      this.onTriggerStop();
    }
  }

  public shutdownSystem(): void {
    console.log('[Scheduler] Queue finished: scheduling system shutdown in 60s');
    if (process.platform === 'win32') {
      execFile('shutdown', ['/s', '/t', '60', '/c', 'Quantum Downloader finished all downloads. Shutting down in 60 seconds.'], { windowsHide: true }, () => {});
    } else if (process.platform === 'darwin') {
      execFile('osascript', ['-e', 'tell application "System Events" to shut down'], () => {});
    } else {
      execFile('shutdown', ['-h', '+1'], () => {});
    }
  }

  public cancelShutdown(): void {
    if (process.platform === 'win32') execFile('shutdown', ['/a'], { windowsHide: true }, () => {});
    else if (process.platform !== 'darwin') execFile('shutdown', ['-c'], () => {});
  }

  public destroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
