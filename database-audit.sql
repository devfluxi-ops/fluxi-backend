-- =========================================
-- FLUXI BACKEND - DATABASE AUDIT SCRIPT
-- =========================================
-- Ejecutar en Supabase SQL Editor
-- Resultados mostrarán estado completo de la BD

-- 1. VERIFICACIÓN DE TABLAS EXISTENTES
-- =========================================

DO $$
DECLARE
    table_record RECORD;
    table_count INTEGER := 0;
    expected_tables TEXT[] := ARRAY[
        'accounts', 'users', 'account_users', 'channel_types',
        'channel_type_fields', 'channels', 'channel_config_values',
        'inventories', 'inventory_stock_items', 'channel_inventory_links',
        'products', 'product_variants', 'channel_products',
        'orders', 'order_items', 'sync_logs'
    ];
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE '1. VERIFICACIÓN DE TABLAS EXISTENTES';
    RAISE NOTICE '========================================';

    FOREACH table_record IN
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
        AND tablename = ANY(expected_tables)
    LOOP
        table_count := table_count + 1;
        RAISE NOTICE '✅ Tabla encontrada: %', table_record.tablename;
    END LOOP;

    RAISE NOTICE '📊 Total tablas encontradas: %/16', table_count;

    IF table_count < 16 THEN
        RAISE NOTICE '❌ FALTAN TABLAS - Verificar script de creación';
    ELSE
        RAISE NOTICE '✅ TODAS LAS TABLAS PRESENTES';
    END IF;
END $$;

-- 2. ESTRUCTURA DETALLADA DE CADA TABLA
-- =========================================

DO $$
DECLARE
    table_info RECORD;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '2. ESTRUCTURA DETALLADA DE TABLAS';
    RAISE NOTICE '========================================';

    FOR table_info IN
        SELECT
            t.table_name,
            c.column_name,
            c.data_type,
            c.is_nullable,
            c.column_default,
            CASE WHEN pk.column_name IS NOT NULL THEN 'PRIMARY KEY' ELSE '' END as key_type,
            CASE WHEN fk.column_name IS NOT NULL THEN 'FOREIGN KEY → ' || fk.foreign_table_name || '.' || fk.foreign_column_name ELSE '' END as fk_info
        FROM information_schema.tables t
        JOIN information_schema.columns c ON t.table_name = c.table_name
        LEFT JOIN (
            SELECT tc.table_name, kcu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
            WHERE tc.constraint_type = 'PRIMARY KEY'
        ) pk ON t.table_name = pk.table_name AND c.column_name = pk.column_name
        LEFT JOIN (
            SELECT
                kcu.table_name,
                kcu.column_name,
                ccu.table_name as foreign_table_name,
                ccu.column_name as foreign_column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
            JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
            WHERE tc.constraint_type = 'FOREIGN KEY'
        ) fk ON t.table_name = fk.table_name AND c.column_name = fk.column_name
        WHERE t.table_schema = 'public'
        AND t.table_name IN ('accounts', 'users', 'account_users', 'channel_types', 'channel_type_fields', 'channels', 'channel_config_values', 'inventories', 'inventory_stock_items', 'channel_inventory_links', 'products', 'product_variants', 'channel_products', 'orders', 'order_items', 'sync_logs')
        ORDER BY t.table_name, c.ordinal_position
    LOOP
        RAISE NOTICE '% | % % | Nullable: % | Default: % | % %',
            table_info.table_name,
            table_info.column_name,
            table_info.data_type,
            table_info.is_nullable,
            COALESCE(table_info.column_default, 'NULL'),
            table_info.key_type,
            table_info.fk_info;
    END LOOP;
END $$;

-- 3. POLÍTICAS RLS (ROW LEVEL SECURITY)
-- =========================================

DO $$
DECLARE
    policy_record RECORD;
    policy_count INTEGER := 0;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '3. POLÍTICAS RLS (ROW LEVEL SECURITY)';
    RAISE NOTICE '========================================';

    FOR policy_record IN
        SELECT
            schemaname,
            tablename,
            policyname,
            permissive,
            roles,
            cmd,
            qual,
            with_check
        FROM pg_policies
        WHERE schemaname = 'public'
        ORDER BY tablename, policyname
    LOOP
        policy_count := policy_count + 1;
        RAISE NOTICE '📋 Tabla: % | Política: % | Comando: % | Roles: %',
            policy_record.tablename,
            policy_record.policyname,
            policy_record.cmd,
            array_to_string(policy_record.roles, ', ');
        RAISE NOTICE '   Condición: %', policy_record.qual;
        RAISE NOTICE '';
    END LOOP;

    RAISE NOTICE '📊 Total políticas RLS: %', policy_count;

    IF policy_count = 0 THEN
        RAISE NOTICE '❌ NO HAY POLÍTICAS RLS - SEGURIDAD COMPROMETIDA';
    ELSE
        RAISE NOTICE '✅ POLÍTICAS RLS CONFIGURADAS';
    END IF;
END $$;

-- 4. ÍNDICES Y PERFORMANCE
-- =========================================

DO $$
DECLARE
    index_record RECORD;
    index_count INTEGER := 0;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '4. ÍNDICES Y PERFORMANCE';
    RAISE NOTICE '========================================';

    FOR index_record IN
        SELECT
            schemaname,
            tablename,
            indexname,
            indexdef
        FROM pg_indexes
        WHERE schemaname = 'public'
        AND tablename IN ('accounts', 'users', 'account_users', 'channel_types', 'channel_type_fields', 'channels', 'channel_config_values', 'inventories', 'inventory_stock_items', 'channel_inventory_links', 'products', 'product_variants', 'channel_products', 'orders', 'order_items', 'sync_logs')
        ORDER BY tablename, indexname
    LOOP
        index_count := index_count + 1;
        RAISE NOTICE '🔍 Tabla: % | Índice: % | Definición: %',
            index_record.tablename,
            index_record.indexname,
            index_record.indexdef;
        RAISE NOTICE '';
    END LOOP;

    RAISE NOTICE '📊 Total índices: %', index_count;
END $$;

-- 5. CONSTRAINTS Y RESTRICCIONES
-- =========================================

DO $$
DECLARE
    constraint_record RECORD;
    constraint_count INTEGER := 0;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '5. CONSTRAINTS Y RESTRICCIONES';
    RAISE NOTICE '========================================';

    FOR constraint_record IN
        SELECT
            tc.table_name,
            tc.constraint_name,
            tc.constraint_type,
            kcu.column_name,
            ccu.table_name as foreign_table,
            ccu.column_name as foreign_column,
            rc.update_rule,
            rc.delete_rule
        FROM information_schema.table_constraints tc
        LEFT JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
        LEFT JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
        LEFT JOIN information_schema.referential_constraints rc ON tc.constraint_name = ccu.constraint_name
        WHERE tc.table_schema = 'public'
        AND tc.table_name IN ('accounts', 'users', 'account_users', 'channel_types', 'channel_type_fields', 'channels', 'channel_config_values', 'inventories', 'inventory_stock_items', 'channel_inventory_links', 'products', 'product_variants', 'channel_products', 'orders', 'order_items', 'sync_logs')
        ORDER BY tc.table_name, tc.constraint_name
    LOOP
        constraint_count := constraint_count + 1;
        RAISE NOTICE '🔒 Tabla: % | Constraint: % (%)',
            constraint_record.table_name,
            constraint_record.constraint_name,
            constraint_record.constraint_type;

        IF constraint_record.constraint_type = 'FOREIGN KEY' THEN
            RAISE NOTICE '   FK: %.% → %.%',
                constraint_record.table_name,
                constraint_record.column_name,
                constraint_record.foreign_table,
                constraint_record.foreign_column;
            RAISE NOTICE '   Reglas: UPDATE=% | DELETE=%',
                constraint_record.update_rule,
                constraint_record.delete_rule;
        END IF;
        RAISE NOTICE '';
    END LOOP;

    RAISE NOTICE '📊 Total constraints: %', constraint_count;
END $$;

-- 6. TRIGGERS Y FUNCIONES
-- =========================================

DO $$
DECLARE
    trigger_record RECORD;
    function_record RECORD;
    trigger_count INTEGER := 0;
    function_count INTEGER := 0;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '6. TRIGGERS Y FUNCIONES';
    RAISE NOTICE '========================================';

    -- Triggers
    FOR trigger_record IN
        SELECT
            event_object_table,
            trigger_name,
            event_manipulation,
            action_timing,
            action_statement
        FROM information_schema.triggers
        WHERE event_object_schema = 'public'
        AND event_object_table IN ('accounts', 'users', 'account_users', 'channel_types', 'channel_type_fields', 'channels', 'channel_config_values', 'inventories', 'inventory_stock_items', 'channel_inventory_links', 'products', 'product_variants', 'channel_products', 'orders', 'order_items', 'sync_logs')
        ORDER BY event_object_table, trigger_name
    LOOP
        trigger_count := trigger_count + 1;
        RAISE NOTICE '⚡ Trigger: % | Tabla: % | Evento: % %',
            trigger_record.trigger_name,
            trigger_record.event_object_table,
            trigger_record.action_timing,
            trigger_record.event_manipulation;
    END LOOP;

    -- Functions
    FOR function_record IN
        SELECT
            routine_name,
            routine_definition
        FROM information_schema.routines
        WHERE routine_schema = 'public'
        AND routine_name LIKE 'is_%'
        ORDER BY routine_name
    LOOP
        function_count := function_count + 1;
        RAISE NOTICE '🔧 Función: %', function_record.routine_name;
    END LOOP;

    RAISE NOTICE '📊 Total triggers: % | Funciones: %', trigger_count, function_count;
END $$;

-- 7. DATOS INICIALES (SEEDS)
-- =========================================

DO $$
DECLARE
    seed_counts RECORD;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '7. DATOS INICIALES (SEEDS)';
    RAISE NOTICE '========================================';

    -- Contar registros en tablas principales
    FOR seed_counts IN
        SELECT
            'channel_types' as table_name, COUNT(*) as count FROM channel_types
        UNION ALL
        SELECT
            'channel_type_fields' as table_name, COUNT(*) as count FROM channel_type_fields
        UNION ALL
        SELECT
            'accounts' as table_name, COUNT(*) as count FROM accounts
        UNION ALL
        SELECT
            'users' as table_name, COUNT(*) as count FROM users
        ORDER BY table_name
    LOOP
        RAISE NOTICE '📊 Tabla: % | Registros: %',
            seed_counts.table_name,
            seed_counts.count;
    END LOOP;
END $$;

-- 8. CONFIGURACIÓN RLS GLOBAL
-- =========================================

DO $$
DECLARE
    rls_enabled_count INTEGER;
    total_tables INTEGER;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '8. CONFIGURACIÓN RLS GLOBAL';
    RAISE NOTICE '========================================';

    SELECT COUNT(*) INTO total_tables
    FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_name IN ('accounts', 'users', 'account_users', 'channel_types', 'channel_type_fields', 'channels', 'channel_config_values', 'inventories', 'inventory_stock_items', 'channel_inventory_links', 'products', 'product_variants', 'channel_products', 'orders', 'order_items', 'sync_logs');

    SELECT COUNT(*) INTO rls_enabled_count
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
    AND c.relname IN ('accounts', 'users', 'account_users', 'channel_types', 'channel_type_fields', 'channels', 'channel_config_values', 'inventories', 'inventory_stock_items', 'channel_inventory_links', 'products', 'product_variants', 'channel_products', 'orders', 'order_items', 'sync_logs')
    AND c.relrowsecurity = true;

    RAISE NOTICE '🔐 RLS habilitado en: %/% tablas', rls_enabled_count, total_tables;

    IF rls_enabled_count = total_tables THEN
        RAISE NOTICE '✅ TODAS LAS TABLAS TIENEN RLS HABILITADO';
    ELSE
        RAISE NOTICE '❌ RLS NO ESTÁ COMPLETAMENTE CONFIGURADO';
    END IF;
END $$;

-- 9. VERIFICACIÓN DE FUNCIONES DE SEGURIDAD
-- =========================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '9. FUNCIONES DE SEGURIDAD';
    RAISE NOTICE '========================================';

    -- Verificar función is_account_member
    IF EXISTS (
        SELECT 1 FROM information_schema.routines
        WHERE routine_schema = 'public'
        AND routine_name = 'is_account_member'
    ) THEN
        RAISE NOTICE '✅ Función is_account_member existe';
    ELSE
        RAISE NOTICE '❌ Función is_account_member NO existe';
    END IF;

    -- Verificar auth.uid() function
    BEGIN
        PERFORM auth.uid();
        RAISE NOTICE '✅ Función auth.uid() disponible';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '❌ Función auth.uid() NO disponible';
    END;
END $$;

-- 10. RESUMEN FINAL DE AUDITORÍA
-- =========================================

DO $$
DECLARE
    total_tables INTEGER;
    tables_with_rls INTEGER;
    total_policies INTEGER;
    total_indexes INTEGER;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '10. RESUMEN FINAL DE AUDITORÍA';
    RAISE NOTICE '========================================';

    SELECT COUNT(*) INTO total_tables
    FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_name IN ('accounts', 'users', 'account_users', 'channel_types', 'channel_type_fields', 'channels', 'channel_config_values', 'inventories', 'inventory_stock_items', 'channel_inventory_links', 'products', 'product_variants', 'channel_products', 'orders', 'order_items', 'sync_logs');

    SELECT COUNT(*) INTO tables_with_rls
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
    AND c.relname IN ('accounts', 'users', 'account_users', 'channel_types', 'channel_type_fields', 'channels', 'channel_config_values', 'inventories', 'inventory_stock_items', 'channel_inventory_links', 'products', 'product_variants', 'channel_products', 'orders', 'order_items', 'sync_logs')
    AND c.relrowsecurity = true;

    SELECT COUNT(*) INTO total_policies
    FROM pg_policies
    WHERE schemaname = 'public';

    SELECT COUNT(*) INTO total_indexes
    FROM pg_indexes
    WHERE schemaname = 'public'
    AND tablename IN ('accounts', 'users', 'account_users', 'channel_types', 'channel_type_fields', 'channels', 'channel_config_values', 'inventories', 'inventory_stock_items', 'channel_inventory_links', 'products', 'product_variants', 'channel_products', 'orders', 'order_items', 'sync_logs');

    RAISE NOTICE '📊 ESTADO GENERAL:';
    RAISE NOTICE '   • Tablas totales: %', total_tables;
    RAISE NOTICE '   • Tablas con RLS: %', tables_with_rls;
    RAISE NOTICE '   • Políticas RLS: %', total_policies;
    RAISE NOTICE '   • Índices: %', total_indexes;
    RAISE NOTICE '';

    IF total_tables = 16 AND tables_with_rls = 16 AND total_policies > 0 THEN
        RAISE NOTICE '🎉 AUDITORÍA EXITOSA - BASE DE DATOS LISTA PARA PRODUCCIÓN';
    ELSE
        RAISE NOTICE '⚠️  AUDITORÍA CON PROBLEMAS - REVISAR CONFIGURACIÓN';
    END IF;
END $$;