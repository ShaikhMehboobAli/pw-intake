import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { CATEGORIES, CategoryDef, FieldDef, FormValues, PHOTOS_KEY, validate } from '../categories';
import type { LocalPhoto, Outbox } from '../outbox';

type Props = {
  outbox: Pick<Outbox, 'enqueue'>;
  categories?: readonly CategoryDef[];
  /** Injected so tests don't need the native picker. */
  pickPhoto?: (source: 'camera' | 'library') => Promise<LocalPhoto | null>;
  notify?: (title: string, message: string) => void;
};

export async function pickWithImagePicker(source: 'camera' | 'library'): Promise<LocalPhoto | null> {
  const perm =
    source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    Alert.alert('Permission needed', `Allow ${source} access to add photos.`);
    return null;
  }
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.6 };
  const result = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  if (result.canceled) return null;
  const a = result.assets[0];
  return { uri: a.uri, name: a.fileName ?? `photo-${Date.now()}.jpg`, type: a.mimeType ?? 'image/jpeg' };
}

export function IntakeScreen({
  outbox,
  categories = CATEGORIES,
  pickPhoto = pickWithImagePicker,
  notify = (t, m) => Alert.alert(t, m),
}: Props) {
  const [categoryId, setCategoryId] = useState(categories[0].id);
  const category = categories.find((c) => c.id === categoryId) ?? categories[0];
  const [values, setValues] = useState<FormValues>({});
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const set = (key: string, v: string) => {
    setValues((prev) => ({ ...prev, [key]: v }));
    if (errors[key]) setErrors(({ [key]: _, ...rest }) => rest);
  };

  const switchCategory = (id: string) => {
    if (id === categoryId) return;
    setCategoryId(id);
    setValues({});
    setErrors({});
  };

  const addPhoto = async (source: 'camera' | 'library') => {
    const photo = await pickPhoto(source);
    if (!photo) return;
    setPhotos((p) => [...p, photo]);
    setErrors(({ [PHOTOS_KEY]: _, ...rest }) => rest);
  };

  const submit = async () => {
    const result = validate(category, values, photos.length);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setSaving(true);
    try {
      await outbox.enqueue({ category: category.id, fields: result.fields, photos });
    } catch (e) {
      // Nothing was saved, so keep everything the dealer entered.
      notify("Couldn't save on this phone", `${(e as Error).message}. Your entries are still here — try again.`);
      return;
    } finally {
      setSaving(false);
    }
    setValues({});
    setPhotos([]);
    setErrors({});
    notify('Saved', "It's stored on this phone and will send automatically, even if the connection drops.");
  };

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      {categories.length > 1 && (
        <View style={styles.chips}>
          {categories.map((c) => (
            <Chip key={c.id} label={c.label} selected={c.id === category.id} onPress={() => switchCategory(c.id)} />
          ))}
        </View>
      )}
      <Text style={styles.title}>New {category.label.toLowerCase()}</Text>

      {category.fields.map((def) => (
        <Field key={`${category.id}.${def.key}`} def={def} value={values[def.key] ?? ''} error={errors[def.key]} onChange={(v) => set(def.key, v)} />
      ))}

      <Text style={styles.label}>
        Photos ({photos.length}
        {category.minPhotos ? `, at least ${category.minPhotos}` : ''})
      </Text>
      {category.photoChecklist && <Text style={styles.hint}>Suggested: {category.photoChecklist.join(', ')}</Text>}
      <View style={styles.photos}>
        {photos.map((p) => (
          <Image key={p.uri} source={{ uri: p.uri }} style={styles.thumb} />
        ))}
      </View>
      {errors[PHOTOS_KEY] && <Text style={styles.error}>{errors[PHOTOS_KEY]}</Text>}
      <View style={styles.row}>
        <Pressable style={styles.secondary} onPress={() => addPhoto('camera')}>
          <Text style={styles.secondaryText}>Take photo</Text>
        </Pressable>
        <Pressable style={styles.secondary} onPress={() => addPhoto('library')}>
          <Text style={styles.secondaryText}>From library</Text>
        </Pressable>
      </View>

      <Pressable
        style={[styles.primary, saving && { opacity: 0.6 }]}
        onPress={submit}
        disabled={saving}
        accessibilityRole="button"
        accessibilityLabel="Submit for appraisal"
      >
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Submit for appraisal</Text>}
      </Pressable>
    </ScrollView>
  );
}

function Field({ def, value, error, onChange }: { def: FieldDef; value: string; error?: string; onChange: (v: string) => void }) {
  const label = `${def.label}${def.required ? ' *' : ''}`;
  return (
    <View style={{ gap: 4 }}>
      <Text style={styles.label}>
        {label}
        {def.kind === 'number' && def.unit ? ` (${def.unit})` : ''}
      </Text>
      {def.kind === 'select' ? (
        <View style={styles.chips}>
          {def.options.map((o) => (
            <Chip key={o} label={o} selected={value === o} onPress={() => onChange(o)} />
          ))}
        </View>
      ) : (
        <TextInput
          accessibilityLabel={def.label}
          style={[styles.input, def.kind === 'multiline' && styles.multiline, error && styles.inputError]}
          value={value}
          onChangeText={onChange}
          placeholder={'placeholder' in def ? def.placeholder : undefined}
          keyboardType={def.kind === 'number' ? 'numeric' : 'default'}
          multiline={def.kind === 'multiline'}
        />
      )}
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 10 },
  title: { fontSize: 22, fontWeight: '600' },
  label: { fontWeight: '600', color: '#333' },
  hint: { color: '#666', fontSize: 13 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, padding: 10, backgroundColor: '#fff' },
  multiline: { height: 100, textAlignVertical: 'top' },
  inputError: { borderColor: '#cf222e' },
  error: { color: '#cf222e', fontSize: 13 },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  thumb: { width: 70, height: 70, borderRadius: 4 },
  row: { flexDirection: 'row', gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: '#bbb', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#fff' },
  chipSelected: { backgroundColor: '#5b2d90', borderColor: '#5b2d90' },
  chipText: { color: '#333' },
  chipTextSelected: { color: '#fff', fontWeight: '600' },
  secondary: { flex: 1, borderWidth: 1, borderColor: '#1f6feb', borderRadius: 6, padding: 12, alignItems: 'center' },
  secondaryText: { color: '#1f6feb', fontWeight: '600' },
  primary: { backgroundColor: '#5b2d90', borderRadius: 6, padding: 14, alignItems: 'center', marginTop: 6 },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
