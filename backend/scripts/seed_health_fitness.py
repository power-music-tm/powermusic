import sys
import uuid
from datetime import datetime, timedelta, timezone
from app.database import SessionLocal
from app import models, schemas
from app.manager_request_intake import (
    create_fresh_manager_request,
    create_handled_manual_request,
)
from app.duplicate_group_service import backfill_duplicate_groups

def run_seed():
    db = SessionLocal()
    PARTNER_ID = 'partner-003'

    dir_bruce = db.query(models.PowermusicUser).filter(models.PowermusicUser.email == 'brucewayne@gmail.com').first()
    dir_nabeeha = db.query(models.PowermusicUser).filter(models.PowermusicUser.email == 'nabeeha529@healthtech.com').first()
    dir_rubab = db.query(models.PowermusicUser).filter(models.PowermusicUser.email == 'rubabzahra248@healthtech.com').first()
    dir_shore = db.query(models.PowermusicUser).filter(models.PowermusicUser.email == 'rubab@shoregtm.com').first()

    now = datetime.now(timezone.utc)
    created_count = 0

    def submit_req(person_dict, action, manager_user, days_ago, notes=None):
        nonlocal created_count
        rec_time = now - timedelta(days=days_ago)
        person = schemas.PersonInfo(**person_dict)
        req = create_fresh_manager_request(
            db,
            person=person,
            action=action,
            manager_notes=notes,
            manager_id=str(manager_user.id),
            partner_id=PARTNER_ID,
            extra_tags=['tag:partner_request', 'tag:verified'],
            received_at=rec_time
        )
        created_count += 1
        db.commit()
        return req

    def create_directory_entry(person_dict, outcome, days_ago, notes=None):
        rec_time = now - timedelta(days=days_ago)
        person = schemas.PersonInfo(**person_dict)
        action = 'Add' if outcome == 'Added' else 'Remove'
        req = create_handled_manual_request(
            db,
            person=person,
            action=action,
            outcome=outcome,
            partner_id=PARTNER_ID,
            manager_notes=notes,
        )
        req.received_at = rec_time - timedelta(hours=2)
        req.handled_at = rec_time
        if outcome == 'Removed':
            req.archived_at = rec_time
            if 'tag:removed' not in (req.tags or []):
                req.tags = list(req.tags or []) + ['tag:removed']
        else:
            req.archived_at = None
        db.commit()
        return req

    print('Starting Health Fitness dataset generation...')

    # Scenario 1: Exact Duplicate
    print('1. Populating Exact Duplicate scenario...')
    submit_req(
        {'firstName': 'HealthTest', 'lastName': 'ExactAdd', 'email': 'exact.add@healthtest.com', 'location': 'Bradford Client'},
        'Add', dir_bruce, 6, 'Initial Add request'
    )
    submit_req(
        {'firstName': 'HealthTest', 'lastName': 'ExactAdd', 'email': 'exact.add@healthtest.com', 'location': 'Bradford Client'},
        'Add', dir_bruce, 5, 'Exact duplicate Add request'
    )
    submit_req(
        {'firstName': 'HealthTest', 'lastName': 'ExactRemove', 'email': 'exact.remove@healthtest.com', 'location': 'Bradford Client'},
        'Remove', dir_nabeeha, 6, 'Initial Remove request'
    )
    submit_req(
        {'firstName': 'HealthTest', 'lastName': 'ExactRemove', 'email': 'exact.remove@healthtest.com', 'location': 'Bradford Client'},
        'Remove', dir_nabeeha, 5, 'Exact duplicate Remove request'
    )

    # Scenario 2: Potential Duplicate
    print('2. Populating Potential Duplicate scenario...')
    submit_req(
        {'firstName': 'HealthTest', 'lastName': 'PotDupOne', 'email': 'potdup1.primary@healthtest.com', 'location': 'London Client'},
        'Add', dir_rubab, 5, 'Primary email submission'
    )
    submit_req(
        {'firstName': 'HealthTest', 'lastName': 'PotDupOne', 'email': 'potdup1.secondary@healthtest.com', 'location': 'London Client'},
        'Add', dir_rubab, 4, 'Secondary email submission (potential duplicate)'
    )
    submit_req(
        {'firstName': 'Steve', 'lastName': 'HealthTest', 'email': 'steve.potdup@healthtest.com', 'location': 'Manchester Client'},
        'Add', dir_shore, 5, 'Steve short name'
    )
    submit_req(
        {'firstName': 'Steven', 'lastName': 'HealthTest', 'email': 'steve.potdup@healthtest.com', 'location': 'Manchester Client'},
        'Add', dir_shore, 4, 'Steven full name'
    )
    submit_req(
        {'firstName': 'Josh', 'lastName': 'HealthTest', 'email': 'josh.potdup@healthtest.com', 'location': 'Leeds Client'},
        'Add', dir_bruce, 5, 'Josh nickname'
    )
    submit_req(
        {'firstName': 'Joshua', 'lastName': 'HealthTest', 'email': 'josh.potdup@healthtest.com', 'location': 'Leeds Client'},
        'Add', dir_bruce, 4, 'Joshua formal name'
    )

    # Scenario 3: Existing Directory
    print('3. Populating Existing Directory scenario...')
    create_directory_entry(
        {'firstName': 'HealthTest', 'lastName': 'ExistDirActive', 'email': 'exist.dir@healthtest.com', 'location': 'Birmingham Client'},
        'Added', 10, 'Active directory record created'
    )
    submit_req(
        {'firstName': 'HealthTest', 'lastName': 'ExistDirActive', 'email': 'exist.dir@healthtest.com', 'location': 'Birmingham Client'},
        'Add', dir_bruce, 3, 'New request for active directory person (Exact)'
    )
    create_directory_entry(
        {'firstName': 'Steven', 'lastName': 'ExistDirVar', 'email': 'steven.dirvar@healthtest.com', 'location': 'Bristol Client'},
        'Added', 10, 'Active directory record (Steven)'
    )
    submit_req(
        {'firstName': 'Steve', 'lastName': 'ExistDirVar', 'email': 'steven.dirvar@healthtest.com', 'location': 'Bristol Client'},
        'Add', dir_shore, 3, 'New request for active directory person (Variation: Steve)'
    )

    # Scenario 4: Already Removed
    print('4. Populating Already Removed scenario...')
    create_directory_entry(
        {'firstName': 'HealthTest', 'lastName': 'RemovedExact', 'email': 'removed.exact@healthtest.com', 'location': 'Liverpool Client'},
        'Removed', 10, 'Person removed from system'
    )
    submit_req(
        {'firstName': 'HealthTest', 'lastName': 'RemovedExact', 'email': 'removed.exact@healthtest.com', 'location': 'Liverpool Client'},
        'Add', dir_nabeeha, 3, 'New Add request for removed person (Exact)'
    )
    create_directory_entry(
        {'firstName': 'Joshua', 'lastName': 'RemovedVar', 'email': 'joshua.remvar@healthtest.com', 'location': 'Sheffield Client'},
        'Removed', 10, 'Person removed from system (Joshua)'
    )
    submit_req(
        {'firstName': 'Josh', 'lastName': 'RemovedVar', 'email': 'joshua.remvar@healthtest.com', 'location': 'Sheffield Client'},
        'Add', dir_bruce, 3, 'New Add request for removed person (Variation: Josh)'
    )

    # Scenario 5: Add AND Remove Flows
    print('5. Populating Add and Remove flows...')
    submit_req(
        {'firstName': 'HealthTest', 'lastName': 'AddRemoveFlow', 'email': 'addremove@healthtest.com', 'location': 'Glasgow Client'},
        'Add', dir_bruce, 5, 'Step 1: Add'
    )
    submit_req(
        {'firstName': 'HealthTest', 'lastName': 'AddRemoveFlow', 'email': 'addremove@healthtest.com', 'location': 'Glasgow Client'},
        'Remove', dir_bruce, 4, 'Step 2: Remove'
    )
    submit_req(
        {'firstName': 'HealthTest', 'lastName': 'RemoveAddFlow', 'email': 'removeadd@healthtest.com', 'location': 'Edinburgh Client'},
        'Remove', dir_rubab, 5, 'Step 1: Remove request'
    )
    submit_req(
        {'firstName': 'HealthTest', 'lastName': 'RemoveAddFlow', 'email': 'removeadd@healthtest.com', 'location': 'Edinburgh Client'},
        'Add', dir_rubab, 4, 'Step 2: Add request'
    )

    # Scenario 6: Multiple Requests for Same Person
    print('6. Populating Multi-request histories...')
    submit_req(
        {'firstName': 'HealthTest', 'lastName': 'MultiSeqOne', 'email': 'multiseq1@healthtest.com', 'location': 'Newcastle Client'},
        'Add', dir_bruce, 6, 'Req 1: Original'
    )
    submit_req(
        {'firstName': 'HealthTest', 'lastName': 'MultiSeqOne', 'email': 'multiseq1@healthtest.com', 'location': 'Newcastle Client'},
        'Add', dir_bruce, 5, 'Req 2: Exact Duplicate'
    )
    submit_req(
        {'firstName': 'HealthTest', 'lastName': 'MultiSeqOne', 'email': 'multiseq1.alt@healthtest.com', 'location': 'Newcastle Client'},
        'Add', dir_bruce, 4, 'Req 3: Potential Duplicate (Alt email)'
    )

    submit_req(
        {'firstName': 'Steve', 'lastName': 'MultiSeqTwo', 'email': 'steve.seq2@healthtest.com', 'location': 'Cardiff Client'},
        'Add', dir_shore, 7, 'Req 1: Base request'
    )
    submit_req(
        {'firstName': 'Steve', 'lastName': 'MultiSeqTwo', 'email': 'steve.seq2@healthtest.com', 'location': 'Cardiff Client'},
        'Add', dir_shore, 6, 'Req 2: Exact Duplicate'
    )
    submit_req(
        {'firstName': 'Steven', 'lastName': 'MultiSeqTwo', 'email': 'steve.seq2@healthtest.com', 'location': 'Cardiff Client'},
        'Add', dir_shore, 5, 'Req 3: Potential Duplicate (Name variation)'
    )
    submit_req(
        {'firstName': 'Steve', 'lastName': 'MultiSeqTwo', 'email': 'steve.seq2.alt@healthtest.com', 'location': 'Cardiff Client'},
        'Add', dir_shore, 4, 'Req 4: Potential Duplicate (Email variation)'
    )

    # Scenario 7: Different Managers / Directors
    print('7. Populating Cross-manager requests...')
    submit_req(
        {'firstName': 'HealthTest', 'lastName': 'CrossManager', 'email': 'crossmanager@healthtest.com', 'location': 'Oxford Client'},
        'Add', dir_bruce, 6, 'Submitted by Director Bruce Wayne'
    )
    submit_req(
        {'firstName': 'HealthTest', 'lastName': 'CrossManager', 'email': 'crossmanager@healthtest.com', 'location': 'Oxford Client'},
        'Add', dir_nabeeha, 5, 'Submitted by Director Nabeeha'
    )
    submit_req(
        {'firstName': 'HealthTest', 'lastName': 'CrossManager', 'email': 'crossmanager@healthtest.com', 'location': 'Oxford Client'},
        'Add', dir_rubab, 4, 'Submitted by Director Rubab Zahra'
    )

    # Scenario 8: Supervisor & Hospital Variations
    print('8. Populating Supervisor & Hospital variations...')
    submit_req(
        {'firstName': 'HealthTest', 'lastName': 'SupHospA', 'email': 'suphosp.a@healthtest.com', 'location': 'City Hospital Client'},
        'Add', dir_bruce, 4, 'Supervisor: Sarah Williams | Hospital: City Hospital'
    )
    submit_req(
        {'firstName': 'HealthTest', 'lastName': 'SupHospB', 'email': 'suphosp.b@healthtest.com', 'location': 'City Hospital Client'},
        'Add', dir_bruce, 4, 'Supervisor: Sarah Williams | Hospital: City Hospital'
    )
    submit_req(
        {'firstName': 'HealthTest', 'lastName': 'SupHospC', 'email': 'suphosp.c@healthtest.com', 'location': 'Royal Hospital Client'},
        'Add', dir_bruce, 4, 'Supervisor: Sarah Williams | Hospital: Royal Hospital'
    )
    submit_req(
        {'firstName': 'HealthTest', 'lastName': 'SupHospD', 'email': 'suphosp.d@healthtest.com', 'location': 'City Hospital Client'},
        'Add', dir_bruce, 4, 'Supervisor: David Brown | Hospital: City Hospital'
    )

    print(f'Total requests created: {created_count}')
    print('Executing backfill grouping engine...')
    summary = backfill_duplicate_groups(db, dry_run=False)
    print('Backfill complete! Groups processed:', summary.get('total_groups_created'))
    db.close()
    print('SUCCESS: Health Fitness test dataset populated!')

if __name__ == '__main__':
    run_seed()
