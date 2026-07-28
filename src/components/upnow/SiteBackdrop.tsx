import styles from './siteBackdrop.module.css';

/**
 * The animated backdrop from the approved design — drifting colour blobs,
 * parallax stars, a shooting star, a masked dot grid and a vignette.
 *
 * Purely decorative, so it is inert to pointers and invisible to screen readers.
 * The parent must be `position: relative; overflow: hidden` — these layers are
 * absolutely positioned and deliberately overflow their bounds.
 */
export function SiteBackdrop() {
  return (
    <div aria-hidden="true">
      <div className={styles.blobA} />
      <div className={styles.blobB} />
      <div className={styles.starsFar} />
      <div className={styles.starsNear} />
      <div className={styles.shootingField}>
        <div className={styles.shootingStar} />
      </div>
      <div className={styles.grid} />
      <div className={styles.vignette} />
    </div>
  );
}
