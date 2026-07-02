import { test, expect } from '@playwright/test';
import fs from 'fs';

test.describe('Dashboard Performance Metrics Budgets', () => {
  test('should load the dashboard within target Core Web Vitals budgets', async ({ page }) => {
    // 1. Establish a DevTools Session to collect low-level CDP metrics
    const client = await page.context().newCDPSession(page);
    await client.send('Performance.enable');

    // Emulate reduced motion inside the test browser context to disable reveal animations
    await page.emulateMedia({ reducedMotion: 'reduce' });

    // 2. Navigate to the dashboard
    await page.goto('http://localhost:4173/');

    // 3. Retrieve Performance metrics
    const performanceMetrics = await client.send('Performance.getMetrics');
    const getMetric = (name) => {
      const metric = performanceMetrics.metrics.find(m => m.name === name);
      return metric ? metric.value : 0;
    };

    // Extract loading times & thread blocking metrics
    const scriptDuration = getMetric('ScriptDuration');   // Total time spent compiling/running JS
    const taskDuration = getMetric('TaskDuration');       // Total main-thread task execution time
    
    console.log(`Main Thread Script Execution Time: ${Math.round(scriptDuration * 1000)}ms`);
    console.log(`Total Main Thread Task Duration: ${Math.round(taskDuration * 1000)}ms`);

    // Extract LCP, CLS, and TBT inside the browser window context
    const vitals = await page.evaluate(() => {
      return new Promise((resolve) => {
        let lcpValue = 0;
        let clsValue = 0;
        const shifts = [];

        // Observe Largest Contentful Paint (LCP)
        new PerformanceObserver((entryList) => {
          const entries = entryList.getEntries();
          lcpValue = entries[entries.length - 1].startTime;
        }).observe({ type: 'largest-contentful-paint', buffered: true });

        // Observe Cumulative Layout Shift (CLS)
        new PerformanceObserver((entryList) => {
          for (const entry of entryList.getEntries()) {
            if (!entry.hadRecentInput) {
              clsValue += entry.value;
              const sources = (entry.sources || []).map(s => {
                const el = s.node;
                // If text node, find parent element
                const target = (el && el.nodeType === 3) ? el.parentNode : el;
                return {
                  nodeType: el ? el.nodeType : 0,
                  nodeName: el ? (el.nodeName || 'unknown') : 'null',
                  tagName: (target && target.tagName) || 'unknown',
                  id: (target && target.id) || 'none',
                  className: (target && target.className) || 'none',
                  value: entry.value
                };
              });
              shifts.push(...sources);
            }
          }
        }).observe({ type: 'layout-shift', buffered: true });

        // Resolve after page is fully loaded and settled
        setTimeout(() => {
          // Approximate Total Blocking Time (TBT) using long tasks from Performance Timeline
          const longTasks = performance.getEntriesByType('longtask') || [];
          const tbtValue = longTasks.reduce((sum, task) => sum + Math.max(0, task.duration - 50), 0);
          
          resolve({ lcp: lcpValue, cls: clsValue, tbt: tbtValue, shifts });
        }, 3000); 
      });
    });

    console.log('--- Core Web Vitals Audited ---');
    console.log(`Largest Contentful Paint (LCP): ${vitals.lcp.toFixed(2)}ms`);
    console.log(`Cumulative Layout Shift (CLS): ${vitals.cls.toFixed(4)}`);
    if (vitals.shifts && vitals.shifts.length > 0) {
      console.log('Layout Shifts Detected:');
      vitals.shifts.forEach((s, idx) => {
        console.log(`  [${idx}] NodeName: ${s.nodeName} (Type ${s.nodeType}) -> Tag: <${s.tagName}>, ID: "${s.id}", Class: "${s.className}", Shift Value: ${s.value}`);
      });
    }
    console.log(`Total Blocking Time (TBT): ${vitals.tbt.toFixed(2)}ms`);
    console.log('--------------------------------');

    fs.writeFileSync('frontend/test/perf-debug.json', JSON.stringify(vitals, null, 2));

    // 4. Assert budgets (Google's "Good" thresholds)
    // LCP budget <= 2.5s (2500ms)
    expect(vitals.lcp).toBeLessThan(2500); 
    // CLS budget <= 0.1
    expect(vitals.cls).toBeLessThan(0.1);   
    // TBT budget <= 200ms
    expect(vitals.tbt).toBeLessThan(200);   
  });
});
