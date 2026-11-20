import { Link } from 'react-router';
import { Icon } from '../../design/components/Icon';
import { TAGS_PATH } from './TagsScreen';

/** Settings' Tags row: opens the list where tags are renamed or deleted. */
export function TagsLink() {
  return (
    <Link to={TAGS_PATH} className="group__row">
      <span className="group__row-start"><span className="tile-icon"><Icon name="lists" size={18} /></span>Tags</span>
      <span className="group__value">Rename or delete</span>
    </Link>
  );
}
