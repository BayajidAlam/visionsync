@echo off
setlocal enabledelayedexpansion

set "basePath=d:\personal\all-projects\poridhi-project\sync\ansible\"
set "deleted=0"
set "notFound=0"

echo Deleting files...

REM Delete individual files
for %%F in (
    "deploy-all.yml"
    "deploy-backend.yml"
    "deploy-client.yml"
    "deploy-containers.yml"
    "deploy-streaming.yml"
    "setup-mongodb-replica-set.yml"
    "setup-mongodb.sh"
    "backend-inventory.j2"
    "inventory.ini"
    "inventory.j2"
    "inventory.template"
    "production-env.j2"
    "README-NEW.md"
    "redis-setup.yml"
    "hosts.ini"
) do (
    set "fullPath=!basePath!%%F"
    if exist "!fullPath!" (
        del /q "!fullPath!"
        echo Deleted: %%F
        set /a deleted+=1
    ) else (
        echo Not found: %%F
        set /a notFound+=1
    )
)

REM Delete template files
for %%F in (
    "templates\docker-compose-redis.yml"
    "templates\docker-compose.yml.j2"
    "templates\redis.conf.j2"
    "templates\redis.service.j2"
) do (
    set "fullPath=!basePath!%%F"
    if exist "!fullPath!" (
        del /q "!fullPath!"
        echo Deleted: %%F
        set /a deleted+=1
    ) else (
        echo Not found: %%F
        set /a notFound+=1
    )
)

REM Delete inventory directory
set "inventoryPath=!basePath!inventory"
if exist "!inventoryPath!" (
    rmdir /s /q "!inventoryPath!"
    echo Deleted: inventory/ ^(directory^)
    set /a deleted+=1
) else (
    echo Not found: inventory/ ^(directory^)
    set /a notFound+=1
)

echo.
echo === SUMMARY ===
echo Deleted: !deleted! items
echo Not found: !notFound! items

endlocal
